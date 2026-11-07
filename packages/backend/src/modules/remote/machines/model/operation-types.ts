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

export interface FileContent {
	path: string;
	name: string;
	sizeBytes: number;
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
	queryIndex: number;
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
	edits: Array<{ oldText: string; newText: string }>;
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
	commands: ExecutionCommand[];
	cwd: string | null;
	onError: 'stop' | 'continue';
	onOutput?(index: number, stream: 'stdout' | 'stderr', text: string, signal: AbortSignal): Promise<void>;
}

export interface ExecuteCommandResult {
	status: 'completed' | 'nonzero';
	commands: Array<
		| { index: number; status: 'not_started' }
		| {
				index: number;
				status: 'completed' | 'nonzero';
				exitCode: number;
				signal: string | null;
				stdout: string;
				stderr: string;
				truncated: boolean;
		  }
	>;
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

export interface MachineResourceSnapshot {
	connections: number;
	files: number;
	active: number;
	targetIds: number[];
	closing: boolean;
	cleanupFailed: boolean;
}

export interface ReadTextPageRequest {
	path: string;
	offset: number;
	maxBytes: number;
}

export interface ReadTextPageResult {
	path: string;
	text: string;
	bytes: number;
	sizeBytes: number;
	offset: number;
	nextOffset: number | null;
	sha256: string | null;
	pageSha256: string;
	fingerprint: string;
}

export interface ReadDirectoryPageRequest {
	path: string;
	after: string;
}

export interface ReadDirectoryPageResult {
	entries: ReadEntry[];
	nextAfter: string | null;
	fingerprint: string;
}

/** Application byte channel; native streams and SSH credentials remain private. */
export interface MachineProcessRequest {
	argv: string[];
	cwd: string;
	maxReadBytes: number;
}

export type MachineProcessOutcome =
	| { kind: 'completed' | 'nonzero'; exitCode: number }
	| {
			kind: 'unknown';
			reason: 'disconnect' | 'timeout' | 'cancelled' | 'channel_error' | 'remote_signal';
			signal: string | null;
	  };

export interface MachineProcessChannel {
	read(stream: 'stdout' | 'stderr', maxBytes: number): Promise<{ bytes: Uint8Array; eof: boolean }>;
	write(bytes: Uint8Array): Promise<void>;
	end(): Promise<void>;
	outcome(): Promise<MachineProcessOutcome>;
	cancel(): void;
	close(): Promise<void>;
}
