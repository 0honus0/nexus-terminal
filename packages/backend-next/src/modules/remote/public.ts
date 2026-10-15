/** Stable backend session-ending contract; independent of internal resources and wire frames. */
export type RemoteSessionCloseReason = 'normal' | 'disconnected' | 'cleanup_failed' | 'closed_by_owner';

/** Internal-only Remote module public contract; not an HTTP/WS DTO. */
export interface SessionView {
	id: string;
	targetId: number;
	fingerprint: string;
	startedAt: number;
	status: 'open' | 'closed';
}

export interface OpenShellRequest {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Methods and unsubscribe callbacks throw only the safe RemoteOperationError from public-errors. */
export interface RemoteSessions {
	open(request: OpenShellRequest): Promise<SessionView>;
	get(id: string): SessionView | null;
	list(): SessionView[];
	/** false means Node stream backpressure, not a failed write. */
	write(id: string, bytes: Uint8Array): boolean;
	resize(id: string, columns: number, rows: number): void;
	onData(id: string, listener: (bytes: Uint8Array) => void): () => void;
	onStderr(id: string, listener: (bytes: Uint8Array) => void): () => void;
	onDrain(id: string, listener: () => void): () => void;
	onClosed(id: string, listener: (reason: RemoteSessionCloseReason) => void): () => void;
	pauseOutput(id: string): void;
	resumeOutput(id: string): void;
	closeSession(id: string): Promise<void>;
}

/** Backend callers must supply their own current authority check; this is not an HTTP identity. */
export interface RemoteMachineOperationScope {
	operationId: string;
	targetId: number;
	fingerprint: string;
	timeoutMs: number;
	signal: AbortSignal;
	validate(): Promise<void>;
}

export interface RemoteReadText {
	path: string;
	text: string;
	bytes: number;
	sha256: string;
}

export interface RemoteReadEntry {
	name: string;
	kind: import('@nexus-terminal/shared/remote/files/values').RemoteFileKind;
	size: number;
	modifiedAt: number;
}

export interface RemoteReadSearch {
	matches: { path: string; line: number; column: number; text: string }[];
	truncated: boolean;
}

export interface RemoteReadDiagnostics {
	generatedAt: number;
	cpuPercent: number | null;
	memUsedBytes: number | null;
	memTotalBytes: number | null;
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	loadAverage: number[];
}

export interface RemoteWriteTextRequest {
	path: string;
	content: string;
	expectedSha256: string;
}

export interface RemoteWriteTextResult {
	path: string;
	status: 'created' | 'replaced';
	bytes: number;
	sha256: string;
}

export interface RemotePathSnapshot {
	path: string;
	kind: 'file' | 'directory';
	fingerprint: string;
	fileCount: number;
	directoryCount: number;
	bytes: number;
}

export interface RemotePatchTextRequest {
	path: string;
	expectedSha256: string;
	oldText: string;
	newText: string;
}

export interface RemoteMovePathRequest {
	path: string;
	destinationPath: string;
	expectedFingerprint: string;
}

export interface RemoteMovePathResult {
	path: string;
	destinationPath: string;
	kind: 'file' | 'directory';
	fingerprint: string;
}

export interface RemoteDeletePathRequest {
	path: string;
	expectedFingerprint: string;
	scope: 'entry' | 'tree';
}

export interface RemoteDeletePathResult {
	path: string;
	kind: 'file' | 'directory';
	fileCount: number;
	directoryCount: number;
}

export type RemoteExecutionCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; script: string };

export interface RemoteExecuteCommandRequest {
	command: RemoteExecutionCommand;
	cwd: string | null;
}

export interface RemoteExecuteCommandResult {
	status: 'completed' | 'nonzero';
	exitCode: number;
	signal: string | null;
	stdout: string;
	stderr: string;
	truncated: boolean;
}

export interface RemoteDockerInspection {
	containerId: string;
	state: string;
	image: string;
	fingerprint: string;
}

export interface RemoteDockerControlRequest {
	containerId: string;
	action: import('@nexus-terminal/shared/remote/docker/values').DockerAction;
	expectedFingerprint: string;
}

export interface RemoteDockerControlResult {
	containerId: string;
	action: import('@nexus-terminal/shared/remote/docker/values').DockerAction;
	state: string | null;
}

export interface RemoteMachineOperations {
	executeAcp(scope: RemoteMachineOperationScope, request: RemoteExecuteAcpRequest): Promise<RemoteExecuteAcpResult>;
	executeCommand(
		scope: RemoteMachineOperationScope,
		request: RemoteExecuteCommandRequest,
	): Promise<RemoteExecuteCommandResult>;
	inspectDocker(scope: RemoteMachineOperationScope, containerId: string): Promise<RemoteDockerInspection>;
	controlDocker(
		scope: RemoteMachineOperationScope,
		request: RemoteDockerControlRequest,
	): Promise<RemoteDockerControlResult>;
	inspectPath(scope: RemoteMachineOperationScope, path: string): Promise<RemotePathSnapshot>;
	patchText(scope: RemoteMachineOperationScope, request: RemotePatchTextRequest): Promise<RemoteWriteTextResult>;
	movePath(scope: RemoteMachineOperationScope, request: RemoteMovePathRequest): Promise<RemoteMovePathResult>;
	deletePath(scope: RemoteMachineOperationScope, request: RemoteDeletePathRequest): Promise<RemoteDeletePathResult>;
	writeText(scope: RemoteMachineOperationScope, request: RemoteWriteTextRequest): Promise<RemoteWriteTextResult>;
	readText(scope: RemoteMachineOperationScope, path: string): Promise<RemoteReadText>;
	list(scope: RemoteMachineOperationScope, path: string): Promise<RemoteReadEntry[]>;
	search(
		scope: RemoteMachineOperationScope,
		path: string,
		query: string,
		maxResults: number,
	): Promise<RemoteReadSearch>;
	diagnose(scope: RemoteMachineOperationScope): Promise<RemoteReadDiagnostics>;
}

export interface RemoteAcpPermissionRequest {
	sessionId: string;
	toolCallId: string;
	requestId: string;
	title: string | null;
	kind: string | null;
	inputJson: string;
}

export interface RemoteAcpPermissionResponse {
	decision: 'allow_once' | 'reject_once';
	delivered(): Promise<void>;
}

export interface RemoteExecuteAcpRequest {
	argv: string[];
	cwd: string;
	prompt: string;
	permission(input: RemoteAcpPermissionRequest, signal: AbortSignal): Promise<RemoteAcpPermissionResponse>;
}

export interface RemoteExecuteAcpResult {
	text: string;
	stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
}
