import type { DockerAction } from '@nexus-terminal/shared/remote/docker/values';

export interface ToolWriteItem {
	path: string;
	content: string;
	expectedSha256: string;
}

export interface ToolMoveItem {
	path: string;
	destinationPath: string;
	expectedFingerprint: string;
}

export interface ToolDeleteItem {
	path: string;
	expectedFingerprint: string;
	scope: 'entry' | 'tree';
}

export interface ToolDockerControlItem {
	containerId: string;
	action: DockerAction;
	expectedFingerprint: string;
}

export interface ToolWriteValue {
	path: string;
	status: 'created' | 'replaced';
	bytes: number;
	sha256: string;
}

export interface ToolMoveValue {
	path: string;
	destinationPath: string;
	kind: 'file' | 'directory';
	fingerprint: string;
}

export interface ToolDeleteValue {
	path: string;
	kind: 'file' | 'directory';
	fileCount: number;
	directoryCount: number;
}

export interface ToolDockerValue {
	containerId: string;
	action: DockerAction;
	state: string | null;
}

export type ToolBatchResult<T = ToolWriteValue | ToolMoveValue | ToolDeleteValue | ToolDockerValue> =
	| { index: number; status: 'completed'; value: T }
	| {
			index: number;
			status: 'failed';
			failureCode: 'not_found' | 'not_text' | 'conflict' | 'command_failed' | 'invalid_input' | 'limit_exceeded';
	  }
	| { index: number; status: 'not_started' }
	| { index: number; status: 'unknown' };
