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

export type ToolBatchResult =
	| { index: number; status: 'completed'; value: unknown }
	| {
			index: number;
			status: 'failed';
			failureCode: 'not_found' | 'not_text' | 'conflict' | 'command_failed' | 'invalid_input' | 'limit_exceeded';
	  }
	| { index: number; status: 'not_started' }
	| { index: number; status: 'unknown' };
