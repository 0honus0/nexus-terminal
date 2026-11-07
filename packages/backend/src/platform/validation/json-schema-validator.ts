import { Ajv } from 'ajv';

/** Technical compilation exposes validity without leaking an Ajv handle into application Models. */
export class JsonSchemaValidator {
	private readonly validateValue: (value: unknown) => boolean;

	constructor(schemaJson: string) {
		const schema: unknown = JSON.parse(schemaJson);
		if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
			throw new TypeError('JSON schema must be an object');
		}
		const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true, validateFormats: false });
		const compiled = ajv.compile(schema);
		this.validateValue = (value) => compiled(value);
	}

	validate(value: unknown): boolean {
		return this.validateValue(value);
	}
}
