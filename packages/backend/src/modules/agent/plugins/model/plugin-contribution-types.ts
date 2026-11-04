import type { PluginSkill } from './plugin-skill-types.js';

export interface PluginAgentContribution {
	role: string;
	toolNames: string[] | null;
	beforeStep: boolean;
	tools: { name: string; description: string }[];
}

export interface PluginAgentCatalog {
	revision: number;
	version: string;
	sha256: string | null;
	contribution: PluginAgentContribution | null;
	skills: PluginSkill[];
}

export type PluginAgentInvocation =
	| { kind: 'context'; runId: string; stepIndex: number; prompt: string }
	| { kind: 'tool'; runId: string; stepIndex: number; operationId: string; name: string; argumentsJson: string };
