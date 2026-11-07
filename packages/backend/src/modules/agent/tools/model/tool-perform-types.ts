import type { HostToolCommand } from './host-tool-command.js';

export type ToolContentInput = Extract<
	HostToolCommand,
	{ kind: 'image_models' | 'image_generate' | 'checkpoint' | 'artifact' | 'memory' | 'result' }
>;

export type ToolRemoteInput = Extract<HostToolCommand, { connectionId: number }>;
