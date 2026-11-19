//go:build windows

package processtree

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestStartKeepsInteractiveWindowsLaunchVisible(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul")
	process, err := Start(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	defer func() {
		process.Stop(0)
		_ = process.Wait()
	}()
	if cmd.SysProcAttr == nil {
		t.Fatal("expected Windows process attributes")
	}
	if cmd.SysProcAttr.HideWindow {
		t.Fatal("interactive process launch must not hide its console window")
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW != 0 {
		t.Fatalf("interactive process launch must not set CREATE_NO_WINDOW; flags=%#x", cmd.SysProcAttr.CreationFlags)
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatalf("expected CREATE_NEW_PROCESS_GROUP; flags=%#x", cmd.SysProcAttr.CreationFlags)
	}
	if process.background {
		t.Fatal("interactive process launch must keep graceful console cancellation enabled")
	}
}

func TestStartBackgroundHidesWindowsConsoleAndKeepsProcessGroup(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul")
	process, err := StartBackground(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	defer func() {
		process.Stop(0)
		_ = process.Wait()
	}()
	if cmd.SysProcAttr == nil {
		t.Fatal("expected Windows process attributes")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("background process launch must hide its console window")
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("expected CREATE_NO_WINDOW; flags=%#x", cmd.SysProcAttr.CreationFlags)
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatalf("expected CREATE_NEW_PROCESS_GROUP; flags=%#x", cmd.SysProcAttr.CreationFlags)
	}
	if !process.background {
		t.Fatal("background process launch must record force-cleanup cancellation semantics")
	}
}

func TestStopAttemptsCtrlBreakOnlyForVisibleWindowsProcesses(t *testing.T) {
	originalCtrlBreak := generateConsoleCtrlEvent
	originalTerminate := terminateJobObject
	defer func() {
		generateConsoleCtrlEvent = originalCtrlBreak
		terminateJobObject = originalTerminate
	}()

	var ctrlBreaks []uint32
	var terminations int
	generateConsoleCtrlEvent = func(_ uint32, processGroupID uint32) error {
		ctrlBreaks = append(ctrlBreaks, processGroupID)
		return nil
	}
	terminateJobObject = func(_ windows.Handle, _ uint32) error {
		terminations++
		return nil
	}

	visible := &Process{cmd: &exec.Cmd{Process: &os.Process{Pid: 42}}, job: windows.Handle(7)}
	visible.Stop(0)
	if len(ctrlBreaks) != 1 || ctrlBreaks[0] != 42 {
		t.Fatalf("expected visible process to receive CTRL_BREAK attempt, got %#v", ctrlBreaks)
	}
	if terminations != 1 {
		t.Fatalf("expected visible process to terminate job once, got %d", terminations)
	}

	ctrlBreaks = nil
	terminations = 0
	background := &Process{cmd: &exec.Cmd{Process: &os.Process{Pid: 84}}, job: windows.Handle(9), background: true}
	background.Stop(0)
	if len(ctrlBreaks) != 0 {
		t.Fatalf("background process must not claim shared-console CTRL_BREAK delivery, got %#v", ctrlBreaks)
	}
	if terminations != 1 {
		t.Fatalf("expected background process to terminate job once, got %d", terminations)
	}
}

func TestStopTerminatesWindowsJob(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul")
	process, err := Start(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	process.Stop(0)
	done := make(chan error, 1)
	go func() { done <- process.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Windows Job Object did not stop its process tree")
	}
}

func TestStopCloseTerminatesBackgroundWindowsProcessTree(t *testing.T) {
	dir := t.TempDir()
	readyPath := filepath.Join(dir, "ready")
	childPIDPath := filepath.Join(dir, "child.pid")
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `
$ErrorActionPreference = 'Stop'
$child = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c','ping -n 30 127.0.0.1 >nul') -PassThru
Set-Content -LiteralPath $env:ENBOR_TEST_CHILD_PID -Value $child.Id -NoNewline
Set-Content -LiteralPath $env:ENBOR_TEST_READY -Value ready -NoNewline
Wait-Process -Id $child.Id
`)
	cmd.Env = append(os.Environ(),
		"ENBOR_TEST_READY="+readyPath,
		"ENBOR_TEST_CHILD_PID="+childPIDPath,
	)
	process, err := StartBackground(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		process.Stop(0)
		_ = process.Close()
	}()
	waitForFile(t, readyPath, 5*time.Second)
	childPIDData, err := os.ReadFile(childPIDPath)
	if err != nil {
		t.Fatal(err)
	}
	childPID, err := strconv.Atoi(strings.TrimSpace(string(childPIDData)))
	if err != nil {
		t.Fatalf("expected child pid, got %q: %v", childPIDData, err)
	}
	child, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(childPID))
	if err != nil {
		t.Fatalf("expected descendant process %d to exist before Stop: %v", childPID, err)
	}
	defer windows.CloseHandle(child)

	process.Stop(0)
	if err := process.Close(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- process.Wait() }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected terminated root process to report an exit error")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("background Windows Job Object did not stop its root process")
	}
	waitForHandleExit(t, child, 5*time.Second, "descendant process")
}

func waitForFile(t *testing.T, path string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", path)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func waitForHandleExit(t *testing.T, handle windows.Handle, timeout time.Duration, label string) {
	t.Helper()
	event, err := windows.WaitForSingleObject(handle, uint32(timeout/time.Millisecond))
	if err != nil {
		t.Fatalf("wait for %s failed: %v", label, err)
	}
	if event != windows.WAIT_OBJECT_0 {
		t.Fatalf("%s did not exit; wait result=%#x", label, event)
	}
}
