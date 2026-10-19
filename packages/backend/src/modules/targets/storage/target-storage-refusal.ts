/** A live persistent reference prevents deletion; independent of SQLite error codes. */
export class TargetReferenceInUse extends Error {
	constructor() {
		super('Target storage reference in use');
		this.name = 'TargetReferenceInUse';
	}
}
