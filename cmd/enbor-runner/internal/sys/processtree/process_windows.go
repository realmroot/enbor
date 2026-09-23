//go:build windows

package processtree

import (
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type Process struct {
	cmd        *exec.Cmd
	job        windows.Handle
	background bool
	once       sync.Once
}

var (
	generateConsoleCtrlEvent = windows.GenerateConsoleCtrlEvent
	terminateJobObject       = windows.TerminateJobObject
)

func Start(cmd *exec.Cmd) (*Process, error) {
	return start(cmd, false)
}

// StartBackground hides console windows for non-interactive probes. Hidden
// children do not share the caller console for CTRL_BREAK; Stop cleans them up
// through the Job Object instead of claiming graceful console delivery.
func StartBackground(cmd *exec.Cmd) (*Process, error) {
	return start(cmd, true)
}

func HideConsoleWindow(cmd *exec.Cmd) {
	attr := sysProcAttr(cmd)
	attr.CreationFlags |= windows.CREATE_NO_WINDOW
	attr.HideWindow = true
}

func start(cmd *exec.Cmd, background bool) (*Process, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		uint32(unsafe.Sizeof(limits)),
	); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	attr := sysProcAttr(cmd)
	attr.CreationFlags |= windows.CREATE_NEW_PROCESS_GROUP
	if background {
		HideConsoleWindow(cmd)
	}
	if err := cmd.Start(); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	processHandle, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_INFORMATION,
		false,
		uint32(cmd.Process.Pid),
	)
	if err != nil {
		_ = cmd.Process.Kill()
		_ = windows.CloseHandle(job)
		return nil, err
	}
	err = windows.AssignProcessToJobObject(job, processHandle)
	_ = windows.CloseHandle(processHandle)
	if err != nil {
		_ = cmd.Process.Kill()
		_ = windows.CloseHandle(job)
		return nil, err
	}
	return &Process{cmd: cmd, job: job, background: background}, nil
}

func sysProcAttr(cmd *exec.Cmd) *syscall.SysProcAttr {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	return cmd.SysProcAttr
}

func (p *Process) Wait() error {
	return p.cmd.Wait()
}

func (p *Process) Stop(grace time.Duration) {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return
	}
	// CREATE_NO_WINDOW children do not share the caller's console, so CTRL_BREAK
	// delivery is only a graceful path for visible process groups.
	if !p.background {
		_ = generateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(p.cmd.Process.Pid))
	}
	if grace > 0 {
		time.Sleep(grace)
	}
	_ = terminateJobObject(p.job, 1)
}

func (p *Process) Close() error {
	if p == nil {
		return nil
	}
	var err error
	p.once.Do(func() {
		err = windows.CloseHandle(p.job)
	})
	return err
}
