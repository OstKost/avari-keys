import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Download, QrCode as QrIcon, FileText, AlertTriangle, ChevronDown, ChevronUp, Zap, ShieldCheck, HelpCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { ClientConfigDetail } from '../types';
import { useToast } from '../context/ToastContext';
import { formatNodeRouting } from '../utils/country';
import { MascotAvatar, MascotFaqModal } from './MascotAssistant';

interface Props {
  keyData: ClientConfigDetail;
  onClose: () => void;
}

// Client-side sanitizer for AmneziaWG / WireGuard config
function sanitizeConfig(raw: string): string {
  if (!raw) return '';
  // Strip ANSI codes
  const withoutAnsi = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\([a-zA-Z]/g, '');
  const lines = withoutAnsi.split(/\r?\n/);
  const result: string[] = [];
  let inConfig = false;
  let seenPeer = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inConfig) {
      if (trimmed.toLowerCase() === '[interface]') {
        inConfig = true;
        result.push('[Interface]');
      }
      continue;
    }

    // Stop on QR Code ASCII art or banners
    if (
      trimmed.startsWith('QR Code') ||
      trimmed.startsWith('Scan ') ||
      trimmed.startsWith('===') ||
      trimmed.startsWith('---') ||
      /[█▀▄░▒▓]/.test(trimmed)
    ) {
      break;
    }

    if (trimmed.toLowerCase() === '[peer]') {
      seenPeer = true;
      result.push('[Peer]');
      continue;
    }

    if (trimmed.toLowerCase() === '[interface]') {
      result.push('[Interface]');
      continue;
    }

    if (trimmed === '') {
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      continue;
    }

    if (trimmed.startsWith('#') || trimmed.includes('=')) {
      result.push(trimmed);
      continue;
    }

    if (seenPeer) {
      break;
    }
  }

  // Trim trailing empty lines
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }

  return inConfig && result.length > 0 ? result.join('\n') : '';
}

export function KeyModal({ keyData, onClose }: Props) {
  const { toast } = useToast();
  const isHysteria = keyData.protocol === 'hysteria2' || (keyData.vpn_uri && keyData.vpn_uri.startsWith('hysteria2://'));
  const [protocol, setProtocol] = useState<'awg' | 'vpn' | 'hysteria2'>(isHysteria ? 'hysteria2' : 'awg');
  const [copied, setCopied] = useState(false);
  const [awgQrUrl, setAwgQrUrl] = useState<string>('');
  const [vpnQrUrl, setVpnQrUrl] = useState<string>('');
  const [hysteriaQrUrl, setHysteriaQrUrl] = useState<string>('');
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [showFaq, setShowFaq] = useState(false);

  const routing = useMemo(() => formatNodeRouting(keyData.node_type || 'direct', (keyData as any).node_country_code), [keyData]);

  const cleanConfig = useMemo(() => sanitizeConfig(keyData.config || ''), [keyData.config]);
  const isValidAwgConfig = useMemo(() => {
    return Boolean(cleanConfig && cleanConfig.includes('[Interface]') && cleanConfig.includes('[Peer]'));
  }, [cleanConfig]);

  const vpnUri = useMemo(() => (keyData.vpn_uri || '').trim(), [keyData.vpn_uri]);
  const hasVpnUri = Boolean(vpnUri);

  const rawWithoutAnsi = useMemo(() => {
    return (keyData.config || '').replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\([a-zA-Z]/g, '').trim();
  }, [keyData.config]);

  // Generate Hysteria QR
  useEffect(() => {
    if (isHysteria && vpnUri) {
      QRCode.toDataURL(vpnUri, {
        width: 320,
        margin: 2,
        color: { dark: '#06141B', light: '#FFFFFF' },
      })
        .then(setHysteriaQrUrl)
        .catch(console.error);
    }
  }, [isHysteria, vpnUri]);

  // Generate AWG QR
  useEffect(() => {
    if (!isValidAwgConfig) {
      setAwgQrUrl('');
      return;
    }

    if (keyData.qr_code && keyData.qr_code.startsWith('data:image/')) {
      setAwgQrUrl(keyData.qr_code);
    } else if (cleanConfig) {
      QRCode.toDataURL(cleanConfig, {
        width: 320,
        margin: 2,
        color: { dark: '#06141B', light: '#FFFFFF' },
      })
        .then(setAwgQrUrl)
        .catch(console.error);
    }
  }, [keyData, cleanConfig, isValidAwgConfig]);

  // Generate VPN QR
  useEffect(() => {
    if (!hasVpnUri || isHysteria) {
      setVpnQrUrl('');
      return;
    }

    if (keyData.vpn_qr_code && keyData.vpn_qr_code.startsWith('data:image/')) {
      setVpnQrUrl(keyData.vpn_qr_code);
    } else {
      QRCode.toDataURL(vpnUri, {
        width: 320,
        margin: 2,
        color: { dark: '#06141B', light: '#FFFFFF' },
      })
        .then(setVpnQrUrl)
        .catch(console.error);
    }
  }, [keyData, vpnUri, hasVpnUri, isHysteria]);

  const handleCopy = () => {
    if (protocol === 'hysteria2') {
      if (!hasVpnUri) {
        toast.error('URI Hysteria 2 отсутствует');
        return;
      }
      navigator.clipboard.writeText(vpnUri);
      setCopied(true);
      toast.success('Ссылка Hysteria 2 (hysteria2://) скопирована в буфер обмена');
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    if (protocol === 'awg') {
      if (!isValidAwgConfig) {
        toast.error('Конфигурация некорректна, копирование невозможно');
        return;
      }
      navigator.clipboard.writeText(cleanConfig);
      setCopied(true);
      toast.success('Конфигурация AmneziaWG скопирована в буфер обмена');
      setTimeout(() => setCopied(false), 2000);
    } else {
      if (!hasVpnUri) {
        toast.error('URI AmneziaVPN отсутствует для данного ключа');
        return;
      }
      navigator.clipboard.writeText(vpnUri);
      setCopied(true);
      toast.success('Ключ AmneziaVPN (vpn://) скопирован в буфер обмена');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (protocol === 'hysteria2') {
      const blob = new Blob([keyData.config || vpnUri], { type: 'text/yaml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${keyData.client_name}.yaml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Конфиг ${keyData.client_name}.yaml скачан`);
      return;
    }

    if (protocol === 'awg') {
      if (!isValidAwgConfig) {
        toast.error('Конфигурация некорректна, скачивание невозможно');
        return;
      }
      const blob = new Blob([cleanConfig], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${keyData.client_name}.conf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Файл ${keyData.client_name}.conf скачан`);
    } else {
      if (!hasVpnUri) {
        toast.error('URI AmneziaVPN отсутствует для данного ключа');
        return;
      }
      const blob = new Blob([vpnUri], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${keyData.client_name}.vpnuri`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Файл ${keyData.client_name}.vpnuri скачан`);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-[#06141B]/85 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-6 overflow-y-auto">
      <div className="bg-[#0A1D26] border border-[#1C3945] hover:border-[#D9B96E]/50 rounded-3xl max-w-lg md:max-w-3xl lg:max-w-4xl w-full p-4 sm:p-6 md:p-8 shadow-2xl shadow-black/90 relative my-auto transition-all duration-300">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 text-[#A8B4B7] hover:text-[#F2F0E8] p-2 rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition z-10"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pr-10">
          <div className="flex items-center space-x-3 sm:space-x-3.5">
            <div className="bg-[#102833] p-2.5 sm:p-3 rounded-2xl text-[#D9B96E] border border-[#1C3945] shrink-0">
              <QrIcon className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h3 className="font-serif text-lg sm:text-2xl font-bold text-[#F2F0E8] tracking-wide">{keyData.device_name}</h3>
              <p className="text-xs sm:text-sm text-[#A8B4B7] mt-0.5 font-sans flex items-center gap-1.5 flex-wrap">
                <span>Сервер:</span>
                <strong className="text-[#D9B96E] font-medium">{keyData.node_name}</strong>
                <span className="text-[#718187]">•</span>
                <span className="bg-[#102833] text-[#D9B96E] px-2 py-0.5 rounded-md font-mono text-xs border border-[#1C3945]">
                  {routing.fullText}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Protocol Switcher Tabs */}
        {isHysteria ? (
          <div className="flex p-1 bg-[#06141B] border border-[#1C3945] rounded-2xl mb-5 sm:mb-6 shadow-inner">
            <div className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-mono uppercase tracking-wider bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-md shadow-black/40">
              <Zap className="w-4 h-4 text-[#D9B96E]" />
              <span>Hysteria 2 (QUIC / UDP)</span>
            </div>
          </div>
        ) : (
          <div className="flex p-1 bg-[#06141B] border border-[#1C3945] rounded-2xl mb-5 sm:mb-6 shadow-inner">
            <button
              type="button"
              onClick={() => setProtocol('awg')}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-mono uppercase tracking-wider transition duration-200 ${
                protocol === 'awg'
                  ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-md shadow-black/40'
                  : 'text-[#A8B4B7] hover:text-[#F2F0E8] hover:bg-[#102833]/40 border border-transparent'
              }`}
            >
              <Zap className="w-4 h-4 text-[#D9B96E]" />
              <span>AmneziaWG (.conf)</span>
            </button>
            <button
              type="button"
              onClick={() => setProtocol('vpn')}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-mono uppercase tracking-wider transition duration-200 ${
                protocol === 'vpn'
                  ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-md shadow-black/40'
                  : 'text-[#A8B4B7] hover:text-[#F2F0E8] hover:bg-[#102833]/40 border border-transparent'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-[#D9B96E]" />
              <span>AmneziaVPN (.vpnuri)</span>
            </button>
          </div>
        )}

        {/* Main Content Area: Adaptive 2-Column on md+ screens */}
        {protocol === 'hysteria2' ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch mb-6">
            {/* QR Code Column */}
            <div className="md:col-span-5 flex flex-col items-center justify-center bg-white p-5 sm:p-6 rounded-2xl shadow-xl border-4 border-[#102833] min-h-[260px]">
              {hysteriaQrUrl ? (
                <>
                  <img src={hysteriaQrUrl} alt="Hysteria 2 QR Code" className="w-48 h-48 sm:w-56 sm:h-56 object-contain rounded-lg" />
                  <span className="text-xs sm:text-sm text-slate-800 font-mono tracking-wider font-semibold mt-3 text-center">
                    Сканируйте в v2rayNG / NekoBox / Shadowrocket
                  </span>
                </>
              ) : (
                <div className="flex items-center justify-center h-48 text-[#718187] text-xs font-mono">
                  Генерация Hysteria QR...
                </div>
              )}
            </div>

            {/* URI Box & Actions Column */}
            <div className="md:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs sm:text-sm font-mono font-semibold text-[#D9B96E] uppercase tracking-wider flex items-center space-x-1.5">
                    <FileText className="w-4 h-4" />
                    <span>Hysteria 2 Ссылка</span>
                  </span>
                  <span className="text-xs text-[#A8B4B7] font-mono">hysteria2://</span>
                </div>
                <pre className="bg-[#06141B] border border-[#1C3945] text-[#F2F0E8] text-xs p-4 rounded-2xl overflow-x-auto max-h-56 md:max-h-64 font-mono scrollbar-thin leading-relaxed whitespace-pre-wrap break-all">
                  {vpnUri}
                </pre>
              </div>

              {/* Actions inside column */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={handleCopy}
                  className="flex items-center justify-center space-x-2 bg-[#102833] text-[#F2F0E8] font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl border border-[#1C3945] hover:bg-[#1C3945] hover:border-[#D9B96E]/50 transition cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#D9B96E]" />}
                  <span>{copied ? 'Скопировано!' : 'Скопировать URI'}</span>
                </button>

                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Скачать .yaml</span>
                </button>
              </div>
            </div>
          </div>
        ) : protocol === 'awg' ? (
          <>
            {isValidAwgConfig ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch mb-6">
                {/* QR Code Column */}
                <div className="md:col-span-5 flex flex-col items-center justify-center bg-white p-5 sm:p-6 rounded-2xl shadow-xl border-4 border-[#102833] min-h-[260px]">
                  {awgQrUrl ? (
                    <>
                      <img src={awgQrUrl} alt="AmneziaWG QR Code" className="w-48 h-48 sm:w-56 sm:h-56 object-contain rounded-lg" />
                      <span className="text-xs sm:text-sm text-slate-800 font-mono tracking-wider font-semibold mt-3 text-center">
                        Сканируйте в приложении AmneziaWG
                      </span>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-48 text-[#718187] text-xs font-mono">
                      Генерация AmneziaWG QR...
                    </div>
                  )}
                </div>

                {/* Config Code & Actions Column */}
                <div className="md:col-span-7 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs sm:text-sm font-mono font-semibold text-[#D9B96E] uppercase tracking-wider flex items-center space-x-1.5">
                        <FileText className="w-4 h-4" />
                        <span>Конфигурационный файл (.conf)</span>
                      </span>
                      <span className="text-xs text-[#A8B4B7] font-mono">AWG Protocol</span>
                    </div>
                    <pre className="bg-[#06141B] border border-[#1C3945] text-[#F2F0E8] text-xs p-4 rounded-2xl overflow-x-auto max-h-56 md:max-h-64 font-mono scrollbar-thin leading-relaxed">
                      {cleanConfig}
                    </pre>
                  </div>

                  {/* Actions inside column */}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <button
                      onClick={handleCopy}
                      disabled={!isValidAwgConfig}
                      className="flex items-center justify-center space-x-2 bg-[#102833] text-[#F2F0E8] font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl border border-[#1C3945] hover:bg-[#1C3945] hover:border-[#D9B96E]/50 transition cursor-pointer"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#D9B96E]" />}
                      <span>{copied ? 'Скопировано!' : 'Скопировать .conf'}</span>
                    </button>

                    <button
                      onClick={handleDownload}
                      disabled={!isValidAwgConfig}
                      className="flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 transition cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Скачать .conf</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 mb-6">
                <div className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-4 text-amber-200">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-sm space-y-1.5 font-sans">
                      <p className="font-semibold text-amber-300">Конфигурация не найдена на сервере</p>
                      <p className="text-amber-200/80 leading-relaxed">
                        Узел не вернул файл конфигурации AmneziaWG (.conf). Убедитесь, что на сервере <strong>{keyData.node_name}</strong> запущен сервис <code>avari-slave</code>.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => setShowRawLogs(!showRawLogs)}
                    className="flex items-center justify-between w-full text-sm font-mono text-[#A8B4B7] hover:text-[#D9B96E] py-1 transition"
                  >
                    <span>{showRawLogs ? 'Скрыть технический ответ узла' : 'Показать технический ответ узла'}</span>
                    {showRawLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showRawLogs && (
                    <pre className="mt-2 bg-[#06141B] border border-[#1C3945] text-red-300/80 text-xs p-3.5 rounded-xl overflow-x-auto max-h-36 font-mono scrollbar-thin leading-relaxed whitespace-pre-wrap break-all">
                      {rawWithoutAnsi || 'Пустой ответ'}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {hasVpnUri ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch mb-6">
                {/* QR Code Column */}
                <div className="md:col-span-5 flex flex-col items-center justify-center bg-white p-5 sm:p-6 rounded-2xl shadow-xl border-4 border-[#102833] min-h-[260px]">
                  {vpnQrUrl ? (
                    <>
                      <img src={vpnQrUrl} alt="AmneziaVPN QR Code" className="w-48 h-48 sm:w-56 sm:h-56 object-contain rounded-lg" />
                      <span className="text-xs sm:text-sm text-slate-800 font-mono tracking-wider font-semibold mt-3 text-center">
                        Сканируйте в приложении AmneziaVPN
                      </span>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-48 text-[#718187] text-xs font-mono">
                      Генерация AmneziaVPN QR...
                    </div>
                  )}
                </div>

                {/* URI Box & Actions Column */}
                <div className="md:col-span-7 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs sm:text-sm font-mono font-semibold text-[#D9B96E] uppercase tracking-wider flex items-center space-x-1.5">
                        <FileText className="w-4 h-4" />
                        <span>Ключ подключения (.vpnuri)</span>
                      </span>
                      <span className="text-xs text-[#A8B4B7] font-mono">AmneziaVPN Client</span>
                    </div>
                    <pre className="bg-[#06141B] border border-[#1C3945] text-[#F2F0E8] text-xs p-4 rounded-2xl overflow-x-auto max-h-56 md:max-h-64 font-mono scrollbar-thin leading-relaxed whitespace-pre-wrap break-all">
                      {vpnUri}
                    </pre>
                  </div>

                  {/* Actions inside column */}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <button
                      onClick={handleCopy}
                      disabled={!hasVpnUri}
                      className="flex items-center justify-center space-x-2 bg-[#102833] text-[#F2F0E8] font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl border border-[#1C3945] hover:bg-[#1C3945] hover:border-[#D9B96E]/50 transition cursor-pointer"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#D9B96E]" />}
                      <span>{copied ? 'Скопировано!' : 'Скопировать URI'}</span>
                    </button>

                    <button
                      onClick={handleDownload}
                      disabled={!hasVpnUri}
                      className="flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 px-3 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 transition cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Скачать .vpnuri</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-4 mb-6 text-amber-200">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1.5 font-sans">
                    <p className="font-semibold text-amber-300">Файл AmneziaVPN (.vpnuri) не найден</p>
                    <p className="text-amber-200/80 leading-relaxed">
                      Для этого ключа на сервере <strong>{keyData.node_name}</strong> не был сформирован файл <code>.vpnuri</code>. Вы можете использовать вкладку <strong>AmneziaWG (.conf)</strong> или пересоздать ключ.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Ari Quick Tip & FAQ Link with Rotating Golden Sheen Border */}
        <div className="mt-5 gold-rotating-border">
          <div className="gold-rotating-border-content p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-3 text-left">
              <MascotAvatar size="xs" withGlow={false} />
              <div className="text-xs text-[#D9E1E3] font-sans">
                <span>Отсканируйте QR в приложении AmneziaWG на телефоне или сохраните .conf для ПК.</span>
                <span className="ml-2 font-serif font-bold text-[#D9B96E] whitespace-nowrap">— Ари</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowFaq(true)}
              className="flex items-center space-x-1.5 text-xs font-mono font-bold text-[#D9B96E] hover:text-[#06141B] hover:bg-[#D9B96E] uppercase tracking-wider px-3.5 py-2 rounded-xl bg-[#06141B] border border-[#D9B96E]/40 transition shrink-0 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Частые вопросы (FAQ)</span>
            </button>
          </div>
        </div>

        {/* Mascot FAQ Modal */}
        <MascotFaqModal
          isOpen={showFaq}
          onClose={() => setShowFaq(false)}
          initialQuestionId="how-to-connect"
        />
      </div>
    </div>,
    document.body
  );
}
