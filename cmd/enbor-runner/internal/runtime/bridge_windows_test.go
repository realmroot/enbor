//go:build windows

package runtime

import (
	"context"
	"testing"

	"golang.org/x/sys/windows"
)

func TestNodeExecutableProbeCommandHidesWindowsConsoleAndKeepsWorkDir(t *testing.T) {
	workDir := t.TempDir()
	cmd := nodeExecutableProbeCommand(context.Background(), "node.exe", workDir)
	if cmd.Dir != workDir {
		t.Fatalf("expected probe work dir %q, got %q", workDir, cmd.Dir)
	}
	if cmd.SysProcAttr == nil {
		t.Fatal("expected Windows process attributes")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("node executable probe must hide its console window")
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("expected CREATE_NO_WINDOW; flags=%#x", cmd.SysProcAttr.CreationFlags)
	}
}
