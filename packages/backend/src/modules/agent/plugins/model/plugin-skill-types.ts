export interface PluginSkillDocument {
	path: string;
	content: string;
	sha256: string;
}

export interface PluginSkill {
	name: string;
	description: string;
	version: string;
	sha256: string;
	body: string;
}

export type PluginSkillInput =
	| { action: 'search'; query: string; limit: number }
	| { action: 'read'; name: string; version: string; sha256: string };
