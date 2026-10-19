import type { CommandErrorCode } from '@nexus-terminal/shared/preferences/commands/values';

export class CommandFailure extends Error {
	constructor(
		readonly code: CommandErrorCode,
		options?: ErrorOptions,
	) {
		super('Command catalog failed: ' + code, options);
		this.name = 'CommandFailure';
	}
}
