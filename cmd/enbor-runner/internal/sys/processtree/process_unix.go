//go:build !windows

package processtree

import (
	"os/exec"
	"syscall"
	"time"
)

type Process struct {
	cmd *exec.Cmd
}

func Start(cmd *exec.Cmd) (*Process, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &Process{cmd: cmd}, nil
}

func StartBackground(cmd *exec.Cmd) (*Process, error) {
	return Start(cmd)
}

func HideConsoleWindow(_ *exec.Cmd) {
}

func (p *Process) Wait() error {
	return p.cmd.Wait()
}

func (p *Process) Stop(grace time.Duration) {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
	if grace > 0 {
		time.Sleep(grace)
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
}

func (p *Process) Close() error {
	return nil
}
