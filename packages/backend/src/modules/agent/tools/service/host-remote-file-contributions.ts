import type { HostOperationResult } from '../model/host-operation-result.js';
import { posix } from 'node:path';
import type { ToolModel } from '../model/tool-model.js';
import type { ToolRemoteFileCommand } from '../model/tool-remote-file-types.js';
import type { HostEffectContribution } from '../model/host-execution-types.js';
import { hostOperationDefinitions } from '../host-operation-rules.js';
import { hostOperationRequest } from './host-operation-input.js';
import { AgentFailure } from '../../agent-failure.js';

/** Single-resource reads; page traversal and model result presentation belong to the package. */
export function hostRemoteFileContributions(model: ToolModel): HostEffectContribution[] {
	return hostOperationDefinitions()
		.filter((definition) => definition.name === 'remote.readTextPage' || definition.name === 'remote.listPage')
		.map((definition): HostEffectContribution => ({
			definition,

			prepare: async (argumentsJson) => {
				const value = hostOperationRequest(definition.name, argumentsJson);
				let command: ToolRemoteFileCommand;
				if (value.operation === 'remote.readTextPage') {
					command = {
						kind: 'read',
						connectionId: value.connectionId,
						input: { path: posix.resolve(value.path), offset: value.offset, maxBytes: value.maxBytes },
					};
				} else if (value.operation === 'remote.listPage') {
					command = {
						kind: 'list',
						connectionId: value.connectionId,
						input: { path: posix.resolve(value.path), after: value.after },
					};
				} else {
					throw new AgentFailure('internal_failure');
				}
				const target = await model.target(command.connectionId);
				return {
					target,
					summary: JSON.stringify({ operation: definition.name, path: command.input.path }),
					risk: 'read',
					mutation: false,
					lifetime: 'operation',

					validate: () => model.validateTarget(target),

					execute: async (context) => {
						const scope = {
							operationId: context.operation.id,
							target,
							timeoutMs: context.limits.toolTimeoutSeconds * 1000,
							signal: context.signal,
							validate: context.validate,
						};
						const remote = model.remote(context.operation);
						const hostResult: HostOperationResult =
							command.kind === 'read'
								? {
										operation: 'remote.readTextPage',
										value: await remote.readTextPage(command.input, scope),
									}
								: { operation: 'remote.listPage', value: await remote.listPage(command.input, scope) };
						await context.validate();
						return {
							text: JSON.stringify(hostResult),
							hostResult,
							targets: [{ id: target.id, version: target.version }],
						};
					},
				};
			},
		}));
}
