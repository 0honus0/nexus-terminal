import type { QuickCommandExpansion } from './quick-command-types';

export function expandQuickCommand(template: string, variables: Record<string, string>): QuickCommandExpansion {
	let command = template;
	for (const [name, value] of Object.entries(variables)) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		command = command.replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), () => value);
	}
	const unresolvedVariables = [...command.matchAll(/\$\{([^}]+)\}/g)]
		.map((match) => match[1])
		.filter((name): name is string => Boolean(name));
	return { command, unresolvedVariables: [...new Set(unresolvedVariables)] };
}
