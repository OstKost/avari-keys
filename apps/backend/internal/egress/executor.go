package egress

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// CommandExecutor executes external OS commands.
type CommandExecutor interface {
	Run(ctx context.Context, name string, args ...string) (string, error)
	Raw(ctx context.Context, name string, args ...string) (int, error)
}

// OSCommandExecutor runs commands via os/exec.
type OSCommandExecutor struct{}

// Run executes the command and returns trimmed stdout, or error with stderr details.
func (e *OSCommandExecutor) Run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		errDetail := strings.TrimSpace(string(out))
		if len(errDetail) > 300 {
			errDetail = errDetail[:300]
		}
		return "", fmt.Errorf("%s %s failed (%v): %s", name, strings.Join(args, " "), err, errDetail)
	}
	return strings.TrimSpace(string(out)), nil
}

// Raw executes command and returns its exit code.
func (e *OSCommandExecutor) Raw(ctx context.Context, name string, args ...string) (int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	err := cmd.Run()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode(), nil
		}
		return -1, err
	}
	return 0, nil
}
