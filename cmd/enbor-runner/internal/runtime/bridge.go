package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sandbox"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/processtree"
	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/runtimebridge"
)

type Bridge struct {
	ShutdownGraceInterval time.Duration
}

const runtimesTimeout = 30 * time.Second
const runtimeBridgeReadyFailureGrace = 2 * time.Second
const runtimeBridgePipeWaitDelay = 500 * time.Millisecond
const nodeExecutableProbeTimeout = 2 * time.Second

func (b Bridge) Run(ctx context.Context, request Request, write EventWriter) (JSON, error) {
	if request.Runtime == "" {
		return nil, fmt.Errorf("runtime is required")
	}
	nodePath, err := resolveNodeExecutable(ctx, request.WorkDir)
	if err != nil {
		return nil, fmt.Errorf("%s runtime requires Node.js with a working executable: %w", request.Runtime, err)
	}
	bridgePath, err := runtimebridge.Materialize()
	if err != nil {
		return nil, err
	}
	commandCtx, cancel := b.commandContext(ctx)
	defer cancel()

	env, err := commandEnvironment(request)
	if err != nil {
		return nil, err
	}
	env = appendRuntimeBridgeHostEnv(env)
	cmd := exec.CommandContext(commandCtx, nodePath, bridgePath)
	cmd.WaitDelay = runtimeBridgePipeWaitDelay
	cmd.Dir = request.WorkDir
	cmd.Env = env
	stdinWriter, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	protocol := bridgeProtocol{}
	stdin := &bridgeStdin{writer: stdinWriter, protocol: protocol}
	stdoutReader, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderrText bytes.Buffer
	cmd.Stderr = &stderrText
	process, err := processtree.Start(cmd)
	if err != nil {
		return nil, err
	}
	defer process.Close()
	processDone := make(chan struct{})
	go func() {
		select {
		case <-commandCtx.Done():
			process.Stop(b.ShutdownGraceInterval)
		case <-processDone:
		}
	}()
	defer close(processDone)

	requestID := "run_" + request.SessionID
	var writeMu sync.Mutex
	writeSerialized := func(event JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return write(event)
	}
	stdoutLines := protocol.lineReader(stdoutReader)
	if err := protocol.waitReady(stdoutLines); err != nil {
		_ = b.waitOrStopProcess(process, runtimeBridgeReadyFailureGrace)
		if stderrText.Len() > 0 {
			return nil, fmt.Errorf("%w: %s", err, stderrText.String())
		}
		return nil, err
	}
	runRequest := runtimebridge.RuntimeBridgeRunMessage{
		Type:          runtimebridge.BridgeMessageTypeRun,
		RequestID:     requestID,
		Runtime:       runtimebridge.ExternalRuntimeName(request.Runtime),
		SessionID:     request.SessionID,
		Cwd:           request.WorkDir,
		Env:           envMap(env),
		Prompt:        request.Prompt,
		Provider:      request.Provider,
		AgentSnapshot: request.AgentSnapshot,
		RuntimeConfig: request.RuntimeConfig,
		Resume:        request.Resume,
		ResumeToken:   request.ResumeToken,
	}
	if request.Model != "" {
		runRequest.Model = request.Model
	}
	if err := stdin.WriteJSON(runRequest); err != nil {
		process.Stop(b.ShutdownGraceInterval)
		_ = process.Wait()
		return nil, err
	}
	if request.RegisterControlSender != nil {
		request.RegisterControlSender(func(command BridgeControlFrame) error {
			frame, err := protocol.controlFrame(requestID, command)
			if err != nil {
				return err
			}
			return stdin.WriteJSON(frame)
		})
	}

	result, readErr := protocol.readResult(
		stdoutLines,
		requestID,
		writeSerialized,
		request.OnResumeToken,
		request.OnProviderEvent,
	)
	_ = stdin.Close()
	if readErr != nil {
		process.Stop(b.ShutdownGraceInterval)
	}
	waitErr := process.Wait()

	final := JSON{"stderr": stderrText.String(), "exitCode": exitCode(waitErr)}
	for key, value := range result {
		final[key] = value
	}
	if readErr != nil {
		final["error"] = readErr.Error()
		// A bridge-reported runtime error is a failed run. The bridge process may
		// later exit cleanly or be killed by cleanup, so keep the public run
		// envelope stable instead of leaking process cleanup status.
		final["exitCode"] = 1
		return final, readErr
	}
	if commandCtx.Err() != nil {
		final["error"] = commandCtx.Err().Error()
		return final, commandCtx.Err()
	}
	if waitErr != nil {
		final["error"] = waitErr.Error()
		return final, fmt.Errorf("%s runtime bridge exited with code %d", request.Runtime, exitCode(waitErr))
	}
	return final, nil
}

func (b Bridge) commandContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithCancel(ctx)
}

func (b Bridge) Inventory(ctx context.Context, includeUsage bool) (*InventorySnapshot, error) {
	return b.inventory(ctx, includeUsage, false)
}

func (b Bridge) Usage(ctx context.Context) (*InventorySnapshot, error) {
	return b.inventory(ctx, true, true)
}

func (b Bridge) inventory(ctx context.Context, includeUsage bool, usageOnly bool) (*InventorySnapshot, error) {
	hostHome, err := os.UserHomeDir()
	if err != nil || hostHome == "" {
		return nil, fmt.Errorf("host home directory is unavailable")
	}
	requestID := "inventory"
	result, err := b.bridgeRequest(ctx, requestID, runtimebridge.RuntimeBridgeInventoryMessage{
		Type:         runtimebridge.BridgeMessageTypeInventory,
		RequestID:    requestID,
		Env:          map[string]string{"ENBOR_RUNTIME_BRIDGE_HOST_HOME": hostHome},
		IncludeUsage: includeUsage,
		UsageOnly:    usageOnly,
	}, runtimesTimeout)
	if err != nil {
		return nil, err
	}
	return bridgeProtocol{}.inventorySnapshot(result)
}

func (b Bridge) bridgeRequest(ctx context.Context, requestID string, request any, timeout time.Duration) (JSON, error) {
	bridgePath, err := runtimebridge.Materialize()
	if err != nil {
		return nil, err
	}
	probeDir, err := os.MkdirTemp("", "enbor-runner-inventory-")
	if err != nil {
		return nil, fmt.Errorf("create runtime inventory directory: %w", err)
	}
	defer os.RemoveAll(probeDir)
	nodePath, err := resolveNodeExecutable(ctx, probeDir)
	if err != nil {
		return nil, fmt.Errorf("node is required to run the runtime bridge and must be working: %w", err)
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, nodePath, bridgePath)
	cmd.WaitDelay = runtimeBridgePipeWaitDelay
	cmd.Dir = probeDir
	cmd.Env = os.Environ()
	stdinWriter, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	protocol := bridgeProtocol{}
	stdin := &bridgeStdin{writer: stdinWriter, protocol: protocol}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	process, err := processtree.StartBackground(cmd)
	if err != nil {
		return nil, err
	}
	defer process.Close()
	defer func() {
		_ = stdin.Close()
		process.Stop(0)
		_ = process.Wait()
	}()

	reader := protocol.lineReader(stdout)
	if err := protocol.waitReady(reader); err != nil {
		return nil, err
	}
	if err := stdin.WriteJSON(request); err != nil {
		return nil, err
	}
	noop := func(JSON) error { return nil }
	return protocol.readResult(reader, requestID, noop, nil, nil)
}

func resolveNodeExecutable(ctx context.Context, workDir string) (string, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return "", err
	}

	probeCtx, cancel := context.WithTimeout(ctx, nodeExecutableProbeTimeout)
	defer cancel()
	probe := nodeExecutableProbeCommand(probeCtx, nodePath, workDir)
	output, err := probe.Output()
	if err != nil {
		return "", fmt.Errorf("resolve node executable: %w", err)
	}
	resolved := strings.TrimSpace(string(output))
	if !filepath.IsAbs(resolved) {
		return "", fmt.Errorf("node returned a non-absolute executable path %q", resolved)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect resolved node executable: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("resolved node executable %q is a directory", resolved)
	}
	return resolved, nil
}

func nodeExecutableProbeCommand(ctx context.Context, nodePath string, workDir string) *exec.Cmd {
	probe := exec.CommandContext(ctx, nodePath, "-p", "process.execPath")
	probe.Dir = workDir
	probe.Env = os.Environ()
	processtree.HideConsoleWindow(probe)
	return probe
}

func commandEnvironment(request Request) ([]string, error) {
	env, err := sandbox.ProcessCommandEnvironment(request.WorkDir)
	if err != nil {
		return nil, err
	}
	config, err := json.Marshal(request.RuntimeConfig)
	if err != nil {
		return nil, err
	}
	env = append(env,
		"ENBOR_SESSION_ID="+request.SessionID,
		"ENBOR_RUNTIME="+request.Runtime,
		"ENBOR_WORKSPACE="+request.WorkDir,
		"ENBOR_RUNTIME_CONFIG="+string(config),
	)
	if request.Provider != "" {
		env = append(env, "ENBOR_PROVIDER="+request.Provider)
	}
	if request.AgentSnapshot != nil {
		snapshot, err := json.Marshal(request.AgentSnapshot)
		if err != nil {
			return nil, err
		}
		env = append(env, "ENBOR_AGENT_SNAPSHOT="+string(snapshot))
	}
	if request.Model != "" {
		env = append(env, "ENBOR_MODEL="+request.Model)
	}
	for key, value := range request.Env {
		if key == "" || strings.Contains(key, "=") {
			return nil, fmt.Errorf("env key %q is invalid", key)
		}
		if isReservedEnvKey(key) {
			return nil, fmt.Errorf("env key %q is reserved", key)
		}
		env = append(env, key+"="+value)
	}
	return env, nil
}

func isReservedEnvKey(key string) bool {
	return len(key) >= len("ENBOR_") && strings.EqualFold(key[:len("ENBOR_")], "ENBOR_")
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitError *exec.ExitError
	if sandbox.AsExitError(err, &exitError) {
		return exitError.ExitCode()
	}
	return 1
}

func bridgePipeClosedAfterResult(err error, result JSON) bool {
	return err != nil && result != nil && errors.Is(err, os.ErrClosed)
}

// bridgeStdin serializes writes to the bridge's stdin so the initial run
// request, injected prompt controls, and the final close cannot interleave.
type bridgeStdin struct {
	mu       sync.Mutex
	writer   io.WriteCloser
	protocol bridgeProtocol
	closed   bool
}

func (s *bridgeStdin) WriteJSON(value any) error {
	data, err := s.protocol.encodeLine(value)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("runtime bridge stdin is closed")
	}
	if _, err := s.writer.Write(data); err != nil {
		return err
	}
	return nil
}

func (s *bridgeStdin) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.writer.Close()
}

func streamBridgeStderr(reader io.Reader, output *bytes.Buffer) error {
	_, err := io.Copy(output, reader)
	return err
}

func envMap(env []string) map[string]string {
	result := make(map[string]string, len(env))
	for _, item := range env {
		for index, char := range item {
			if char == '=' {
				result[item[:index]] = item[index+1:]
				break
			}
		}
	}
	return result
}

func appendRuntimeBridgeHostEnv(env []string) []string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		env = append(env, "ENBOR_RUNTIME_BRIDGE_HOST_HOME="+home)
	}
	for _, key := range []string{
		"PATHEXT",
		"USERPROFILE",
		"APPDATA",
		"LOCALAPPDATA",
		"HOMEDRIVE",
		"HOMEPATH",
		"VOLTA_HOME",
		"NODE_PATH",
		"PNPM_HOME",
		"NVM_DIR",
		"ENBOR_RUNTIME_BRIDGE_TEST_MODE",
		"ENBOR_CODEX_SANDBOX_MODE",
		"ENBOR_CODEX_APPROVAL_POLICY",
		"ENBOR_CLAUDE_CODE_PERMISSION_MODE",
	} {
		if value, ok := os.LookupEnv(key); ok && value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func (b Bridge) waitOrStopProcess(process *processtree.Process, grace time.Duration) error {
	done := make(chan error, 1)
	go func() {
		done <- process.Wait()
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(grace):
		process.Stop(b.ShutdownGraceInterval)
		return <-done
	}
}
