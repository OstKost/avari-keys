import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('egress', Path(__file__).with_name('avari-egress.py'))
egress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(egress)


class EgressTests(unittest.TestCase):
    def test_missing_or_multiple_defaults_are_unknown(self):
        for routes in ['', 'default via 192.0.2.1', 'default dev awg1\ndefault dev awg2']:
            with patch.object(egress, 'run', return_value=routes):
                self.assertEqual('', egress.active())
        with patch.object(egress, 'run', return_value='default dev awg2 scope link'):
            self.assertEqual('awg2', egress.active())

    def test_registry_rejects_untrusted_interface_and_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'registry.json'
            for interface, endpoint in [('awg1;shutdown', '192.0.2.1'), ('awg1', 'example.org')]:
                config.write_text(json.dumps([dict(interface=interface, endpoint=endpoint)]))
                with patch.object(egress, 'CONFIG', config):
                    with self.assertRaises(ValueError):
                        egress.registry()

    def test_rollback_restores_routes_selection_and_removes_only_new_nat(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / 'state'
            pending = Path(tmp) / 'pending'
            pending.write_text('{}')
            snapshot = dict(routes={'default': ['default dev awg2 scope link'], '198.51.100.0/24': []}, selection='AWG1_IF="awg2"\n', target='awg4', nat_added=True, subnet='192.0.2.0/24')
            with patch.object(egress, 'STATE', state), patch.object(egress, 'PENDING', pending), patch.object(egress, 'run') as run, patch.object(egress.subprocess, 'run') as raw:
                egress.rollback(snapshot)
                run.assert_called_once_with('ip', '-4', 'route', 'replace', 'default', 'dev', 'awg2', 'scope', 'link', 'table', '100')
                self.assertEqual(state.read_text(), snapshot['selection'])
                self.assertFalse(pending.exists())
                self.assertEqual(raw.call_args.args[0][3], '-D')

    def test_probe_rejects_wrong_exit_ip(self):
        with patch.object(egress.Path, 'exists', return_value=True), patch.object(egress, 'run', return_value='192.0.2.2'):
            with self.assertRaisesRegex(RuntimeError, 'IP'):
                egress.probe(dict(interface='awg4', endpoint='192.0.2.1'))

    @contextlib.contextmanager
    def transaction(self, target='awg4', nat_exists=False):
        # Exercise main() and real file persistence/rollback, mocking only OS commands.
        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
            root = Path(tmp)
            state, pending, subnet = root / 'state', root / 'pending', root / 'subnet'
            previous = 'AWG1_IF="awg2"\nAWG1_ENDPOINT="192.0.2.2"\n'
            state.write_text(previous)
            subnet.write_text('198.51.100.0/24')
            entry = dict(interface='awg4', endpoint='192.0.2.4')
            real_open = open
            def redirected_open(path, *args, **kwargs):
                if str(path) == '/root/awg/awg-routing.lock':
                    path = root / 'lock'
                return real_open(path, *args, **kwargs)
            stack.enter_context(patch('builtins.open', side_effect=redirected_open))
            for key, value in [('STATE', state), ('PENDING', pending), ('SUBNET_FILE', subnet)]:
                stack.enter_context(patch.object(egress, key, value))
            stack.enter_context(patch.object(egress.sys, 'argv', ['avari-egress', 'switch', target]))
            stack.enter_context(patch.object(egress, 'registry', return_value=[entry]))
            stack.enter_context(patch.object(egress, 'active', return_value='awg2'))
            probe = stack.enter_context(patch.object(egress, 'probe'))
            def command(*args, **kwargs):
                if args == ('ip', '-4', 'route', 'show', 'table', '100', 'default'):
                    return 'default dev awg2 scope link'
                if args[:5] == ('ip', '-4', 'route', 'show', 'exact'):
                    return args[5] + ' dev awg2 scope link'
                return ''
            run = stack.enter_context(patch.object(egress, 'run', side_effect=command))
            raw = stack.enter_context(patch.object(egress.subprocess, 'run', return_value=SimpleNamespace(returncode=0 if nat_exists else 1)))
            yield SimpleNamespace(state=state, pending=pending, previous=previous, probe=probe, run=run, raw=raw, entry=entry)

    def test_unknown_target_does_not_probe_or_change_routes(self):
        with self.transaction(target='awg99') as tx:
            with self.assertRaisesRegex(ValueError, 'конфигурации'):
                egress.main()
            tx.probe.assert_not_called()
            tx.run.assert_not_called()
            tx.raw.assert_not_called()
            self.assertEqual(tx.previous, tx.state.read_text())
            self.assertFalse(tx.pending.exists())

    def test_failed_preflight_does_not_change_routes_or_create_pending_transaction(self):
        with self.transaction() as tx:
            tx.probe.side_effect = RuntimeError('tunnel unavailable')
            with self.assertRaisesRegex(RuntimeError, 'tunnel unavailable'):
                egress.main()
            tx.run.assert_not_called()
            tx.raw.assert_not_called()
            self.assertEqual(tx.previous, tx.state.read_text())
            self.assertFalse(tx.pending.exists())

    def test_post_switch_failure_rolls_back_all_routes_and_selection(self):
        with self.transaction() as tx:
            tx.probe.side_effect = [None, RuntimeError('post-switch verification failed')]
            with self.assertRaisesRegex(RuntimeError, 'post-switch verification failed'):
                egress.main()
            commands = [call.args for call in tx.run.call_args_list]
            self.assertIn(('ip', '-4', 'route', 'replace', 'default', 'dev', 'awg4', 'table', '100'), commands)
            self.assertIn(('ip', '-4', 'route', 'replace', 'default', 'dev', 'awg2', 'scope', 'link', 'table', '100'), commands)
            for prefix in egress.NETWORKS:
                self.assertIn(('ip', '-4', 'route', 'replace', prefix, 'dev', 'awg2', 'scope', 'link'), commands)
            nat_deletes = [call.args[0] for call in tx.raw.call_args_list if call.args[0][0] == 'iptables' and call.args[0][3] == '-D']
            self.assertEqual(1, len(nat_deletes))
            self.assertEqual(tx.previous, tx.state.read_text())
            self.assertFalse(tx.pending.exists())
            self.assertTrue(any(call.args[0][:2] == ['systemctl', 'stop'] for call in tx.raw.call_args_list))

    def test_concurrent_operation_is_refused_before_probe_or_route_changes(self):
        with self.transaction() as tx, patch.object(egress.fcntl, 'flock', side_effect=BlockingIOError):
            with self.assertRaisesRegex(RuntimeError, 'операция'):
                egress.main()
            tx.probe.assert_not_called()
            tx.run.assert_not_called()
            tx.raw.assert_not_called()
            self.assertEqual(tx.previous, tx.state.read_text())
            self.assertFalse(tx.pending.exists())


if __name__ == '__main__':
    unittest.main()
