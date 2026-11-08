import assert from 'node:assert/strict';
import { test } from 'vitest';
import { chatModelRequest } from '../../../../../packages/backend/src/platform/ai/adapters/model-request.ts';
import { responseModelRequest } from '../../../../../packages/backend/src/platform/ai/adapters/model-request.ts';
import { ModelNetworkFailure } from '../../../../../packages/backend/src/platform/ai/model-port.ts';

test('Agent modular: both actual provider request adapters preserve complete nested signed schemas', () => {
	const parameters = {
		type: 'object',
		description: 'Root description',
		additionalProperties: false,
		required: ['nested'],
		properties: {
			nested: {
				type: 'object',
				additionalProperties: false,
				required: ['flags'],
				properties: {
					flags: {
						type: 'array',
						description: 'Flags',
						items: { type: 'boolean', description: 'Enabled' },
						minItems: 0,
						maxItems: 4,
					},
					count: { type: 'integer', minimum: -2, maximum: 5 },
					ratio: { type: 'number', minimum: 0.25, maximum: 1.75 },
					mode: {
						type: 'string',
						description: 'Selected mode',
						minLength: 1,
						maxLength: 8,
						enum: ['fast', 'safe'],
					},
				},
			},
		},
	};
	const input = {
		baseUrl: 'https://example.test/v1',
		protocol: 'chat-completions',
		modelId: 'test',
		credential: null,
		maxOutputTokens: 128,
		usesReasoning: false,
		messages: [{ role: 'user', content: 'hello' }],
		tools: [{ name: 'sample', description: 'Sample tool', parameters }],
	};
	const chat = chatModelRequest(input);
	const responses = responseModelRequest({ ...input, protocol: 'responses' });
	assert.deepEqual(chat.tools[0].function.parameters, parameters);
	assert.deepEqual(responses.tools[0].parameters, parameters);
	assert.notEqual(chat.tools[0].function.parameters, parameters, 'the SDK boundary owns its white-list projection');
	assert.notEqual(responses.tools[0].parameters.properties.nested, parameters.properties.nested);
	for (const changed of [
		{ ...parameters, $ref: '#/$defs/root' },
		{ ...parameters, required: ['missing'] },
		{ ...parameters, required: [], properties: { ratio: { type: 'number', minimum: 2, maximum: 1 } } },
		{ ...parameters, required: [], properties: { mode: { type: 'string', pattern: '.*' } } },
		{ type: 'array', items: { type: 'string' } },
	]) {
		const invalid = { ...input, tools: [{ ...input.tools[0], parameters: changed }] };
		assert.throws(() => chatModelRequest(invalid), ModelNetworkFailure);
		assert.throws(() => responseModelRequest({ ...invalid, protocol: 'responses' }), ModelNetworkFailure);
	}
});
