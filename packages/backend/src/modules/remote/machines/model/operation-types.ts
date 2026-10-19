import type { RemoteFileKind } from '@nexus-terminal/shared/remote/files/values';
import type { FileResource } from '../../files/model/file-types.js';

export interface FileInspectionContext {
	resource: FileResource;
	signal: AbortSignal;
	remaining(): number;
	validate(): Promise<void>;
}

/** The caller owns authorization; the reader rechecks it at each asynchronous boundary. */
export interface MachineOperationScope {
	operationId: string;
	targetId: number;
	fingerprint: string;
	timeoutMs: number;
	signal: AbortSignal;
	validate(): Promise<void>;
}

export interface ReadTextResult {
	path: string;
	text: string;
	bytes: number;
	sha256: string;
}

export interface ReadEntry {
	name: string;
	kind: RemoteFileKind;
	size: number;
	modifiedAt: number;
}

export interface ReadSearchMatch {
	path: string;
	line: number;
	column: number;
	text: string;
}

export interface ReadSearchResult {
	matches: ReadSearchMatch[];
	truncated: boolean;
}

export interface ReadDiagnostics {
	generatedAt: number;
	cpuPercent: number | null;
	memUsedBytes: number | null;
	memTotalBytes: number | null;
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	loadAverage: number[];
}

export interface WriteTextRequest {
	path: string;
	content: string;
	expectedSha256: string;
}

export interface WriteTextResult {
	path: string;
	status: 'created' | 'replaced';
	bytes: number;
	sha256: string;
}

export interface InspectPathResult {
	path: string;
	kind: 'file' | 'directory';
	fingerprint: string;
	fileCount: number;
	directoryCount: number;
	bytes: number;
}

export interface PatchTextRequest {
	path: string;
	expectedSha256: string;
	oldText: string;
	newText: string;
}

export interface MovePathRequest {
	path: string;
	destinationPath: string;
	expectedFingerprint: string;
}

export interface MovePathResult {
	path: string;
	destinationPath: string;
	kind: 'file' | 'directory';
	fingerprint: string;
}

export interface DeletePathRequest {
	path: string;
	expectedFingerprint: string;
	scope: 'entry' | 'tree';
}

export interface DeletePathResult {
	path: string;
	kind: 'file' | 'directory';
	fileCount: number;
	directoryCount: number;
}

export type ExecutionCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; script: string };

export interface ExecuteCommandRequest {
	command: ExecutionCommand;
	cwd: string | null;
}

export interface ExecuteCommandResult {
	status: 'completed' | 'nonzero';
	exitCode: number;
	signal: string | null;
	stdout: string;
	stderr: string;
	truncated: boolean;
}

export interface DockerInspection {
	containerId: string;
	state: string;
	image: string;
	fingerprint: string;
}

export interface DockerControlRequest {
	containerId: string;
	action: import('@nexus-terminal/shared/remote/docker/values').DockerAction;
	expectedFingerprint: string;
}

export interface DockerControlResult {
	containerId: string;
	action: import('@nexus-terminal/shared/remote/docker/values').DockerAction;
	state: string | null;
}

export interface AcpPermissionRequest {
	sessionId: string;
	toolCallId: string;
	requestId: string;
	title: string | null;
	kind: string | null;
	inputJson: string;
}

export interface AcpPermissionResponse {
	decision: 'allow_once' | 'reject_once';
	delivered(): Promise<void>;
}

export interface ExecuteAcpRequest {
	argv: string[];
	cwd: string;
	prompt: string;
	permission(input: AcpPermissionRequest, signal: AbortSignal): Promise<AcpPermissionResponse>;
}

export interface ExecuteAcpResult {
	text: string;
	stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
}

export interface MachineClientIdentity {
	name: string;
	version: string;
}
