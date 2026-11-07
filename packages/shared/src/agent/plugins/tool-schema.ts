import { agentRecord, agentInteger, isAgentRecord, InvalidAgentPayload } from '../http-codec.js';

interface AgentPluginSchemaDescription {
	description?: string;
}

export interface AgentPluginToolInputSchema extends AgentPluginSchemaDescription {
	type: 'object';
	properties: Record<string, AgentPluginInputSchema>;
	required: string[];
	additionalProperties: false;
}

export type AgentPluginInputSchema =
	| AgentPluginToolInputSchema
	| (AgentPluginSchemaDescription & {
			type: 'string';
			minLength?: number;
			maxLength?: number;
			enum?: string[];
	  })
	| (AgentPluginSchemaDescription & { type: 'number' | 'integer'; minimum?: number; maximum?: number })
	| (AgentPluginSchemaDescription & { type: 'boolean' })
	| (AgentPluginSchemaDescription & {
			type: 'array';
			items: AgentPluginInputSchema;
			minItems?: number;
			maxItems?: number;
	  });

function schemaRecord(input: unknown, required: string[], optional: string[]): Record<string, unknown> {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	return agentRecord(input, [...required, ...optional.filter((key) => Object.hasOwn(input, key))]);
}

function schemaText(input: unknown): string {
	if (typeof input !== 'string' || input.includes('\0')) {
		throw new InvalidAgentPayload();
	}
	return input;
}

function copyDescription(row: Record<string, unknown>, result: AgentPluginSchemaDescription): void {
	if (Object.hasOwn(row, 'description')) {
		result.description = schemaText(row.description);
	}
}

function finite(input: unknown): number {
	if (typeof input !== 'number' || !Number.isFinite(input)) {
		throw new InvalidAgentPayload();
	}
	return input;
}

function bounds(minimum: number | undefined, maximum: number | undefined): void {
	if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
		throw new InvalidAgentPayload();
	}
}

/** The signed schema subset has no references or executable keywords. Parameter validation belongs to the host. */
export function readAgentPluginInputSchema(input: unknown): AgentPluginInputSchema {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	if (input.type === 'object') {
		return readAgentPluginToolInputSchema(input);
	}
	if (input.type === 'boolean') {
		const row = schemaRecord(input, ['type'], ['description']);
		const result: AgentPluginInputSchema = { type: 'boolean' };
		copyDescription(row, result);
		return result;
	}
	if (input.type === 'string') {
		const row = schemaRecord(input, ['type'], ['description', 'minLength', 'maxLength', 'enum']);
		const minLength = Object.hasOwn(row, 'minLength') ? agentInteger(row.minLength) : undefined;
		const maxLength = Object.hasOwn(row, 'maxLength') ? agentInteger(row.maxLength) : undefined;
		bounds(minLength, maxLength);
		let values: string[] | undefined;
		if (Object.hasOwn(row, 'enum')) {
			if (!Array.isArray(row.enum) || row.enum.length === 0) {
				throw new InvalidAgentPayload();
			}
			values = row.enum.map(schemaText);
			if (new Set(values).size !== values.length) {
				throw new InvalidAgentPayload();
			}
		}
		const result: AgentPluginInputSchema = { type: 'string' };
		copyDescription(row, result);
		if (minLength !== undefined) {
			result.minLength = minLength;
		}
		if (maxLength !== undefined) {
			result.maxLength = maxLength;
		}
		if (values !== undefined) {
			result.enum = values;
		}
		return result;
	}
	if (input.type === 'number' || input.type === 'integer') {
		const row = schemaRecord(input, ['type'], ['description', 'minimum', 'maximum']);
		const minimum = Object.hasOwn(row, 'minimum') ? finite(row.minimum) : undefined;
		const maximum = Object.hasOwn(row, 'maximum') ? finite(row.maximum) : undefined;
		bounds(minimum, maximum);
		const result: AgentPluginInputSchema = { type: input.type };
		copyDescription(row, result);
		if (minimum !== undefined) {
			result.minimum = minimum;
		}
		if (maximum !== undefined) {
			result.maximum = maximum;
		}
		return result;
	}
	if (input.type === 'array') {
		const row = schemaRecord(input, ['type', 'items'], ['description', 'minItems', 'maxItems']);
		const minItems = Object.hasOwn(row, 'minItems') ? agentInteger(row.minItems) : undefined;
		const maxItems = Object.hasOwn(row, 'maxItems') ? agentInteger(row.maxItems) : undefined;
		bounds(minItems, maxItems);
		const result: AgentPluginInputSchema = { type: 'array', items: readAgentPluginInputSchema(row.items) };
		copyDescription(row, result);
		if (minItems !== undefined) {
			result.minItems = minItems;
		}
		if (maxItems !== undefined) {
			result.maxItems = maxItems;
		}
		return result;
	}
	throw new InvalidAgentPayload();
}

export function readAgentPluginToolInputSchema(input: unknown): AgentPluginToolInputSchema {
	const row = schemaRecord(input, ['type', 'properties', 'required', 'additionalProperties'], ['description']);
	if (
		row.type !== 'object' ||
		row.additionalProperties !== false ||
		!isAgentRecord(row.properties) ||
		!Array.isArray(row.required)
	) {
		throw new InvalidAgentPayload();
	}
	const properties: Record<string, AgentPluginInputSchema> = {};
	for (const [key, value] of Object.entries(row.properties)) {
		schemaText(key);
		Object.defineProperty(properties, key, {
			value: readAgentPluginInputSchema(value),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	const required = row.required.map(schemaText);
	if (new Set(required).size !== required.length || required.some((key) => !Object.hasOwn(properties, key))) {
		throw new InvalidAgentPayload();
	}
	const result: AgentPluginToolInputSchema = { type: 'object', properties, required, additionalProperties: false };
	copyDescription(row, result);
	return result;
}
