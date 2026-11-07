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
	{ action: 'catalog'; offset: number } | { action: 'read'; name: string; version: string; sha256: string };

export type PluginSkillResult =
	| {
			operation: 'skills.catalog';
			value: {
				items: { name: string; description: string; version: string; sha256: string }[];
				nextOffset: number | null;
				catalogSha256: string;
			};
	  }
	| {
			operation: 'skills.read';
			value: { name: string; description: string; version: string; sha256: string; body: string };
	  };

/** Signed documents exposed by an App or an explicitly selected capability root. */
export interface PluginSkillCatalog {
	packageId: string;
	revision: number;
	skills: PluginSkill[];
}
