import type { AgentPluginHostOperationRequest } from '@nexus-terminal/shared/agent/plugins/host-operations';
import { AGENT_PLUGIN_HOST_OPERATIONS } from '@nexus-terminal/shared/agent/plugins/values';
import { readAgentPluginHostOperationRequestFor } from '@nexus-terminal/shared/agent/plugins/host-operations-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HostToolCommand } from '../model/host-tool-command.js';
import { AgentFailure } from '../../agent-failure.js';

export function hostOperationRequest(name: string, argumentsJson: string): AgentPluginHostOperationRequest {
	try {
		const raw: unknown = JSON.parse(argumentsJson);
		const operation = AGENT_PLUGIN_HOST_OPERATIONS.find((entry) => entry === name);
		if (!operation) {
			throw new AgentFailure('invalid_input');
		}
		return readAgentPluginHostOperationRequestFor(operation, raw);
	} catch (cause) {
		if (cause instanceof InvalidAgentPayload || cause instanceof SyntaxError) {
			throw new AgentFailure('invalid_input', { cause });
		}
		throw cause;
	}
}

/** Shared values are projected field by field into application-owned resource commands. */
export function hostOperationCommand(value: AgentPluginHostOperationRequest): HostToolCommand {
	switch (value.operation) {
		case 'discovery.catalog':
			return { kind: 'discovery_catalog', cursor: value.cursor, sha256: value.sha256 };
		case 'discovery.activate':
			return { kind: 'discovery_activate', names: value.names.map((name) => name) };
		case 'targets.list':
			return { kind: 'connections' };
		case 'diagnostics.host':
			return { kind: 'host_diagnostics' };
		case 'browser.catalog':
			return { kind: 'browser_targets' };
		case 'diagnostics.readTarget':
			return { kind: 'diagnostics', connectionId: value.connectionId };
		case 'skills.catalog':
			return { kind: 'skill', input: { action: 'catalog', offset: value.offset } };
		case 'skills.read':
			return {
				kind: 'skill',
				input: { action: 'read', name: value.name, version: value.version, sha256: value.sha256 },
			};
		case 'images.list':
			return { kind: 'image_models' };
		case 'images.generate':
			return {
				kind: 'image_generate',
				input: {
					providerId: value.providerId,
					configurationVersion: value.configurationVersion,
					modelId: value.modelId,
					prompt: value.prompt,
				},
			};
		case 'context.readResults':
			return {
				kind: 'result',
				item: {
					toolCallId: value.item.toolCallId,
					sha256: value.item.sha256,
					offset: value.item.offset,
					maxBytes: value.item.maxBytes,
				},
			};
		case 'artifacts.create':
			return {
				kind: 'artifact',
				action: 'create',
				name: value.name,
				mediaType: value.mediaType,
				base64: value.base64,
			};
		case 'artifacts.read':
			return {
				kind: 'artifact',
				action: 'read',
				artifactId: value.artifactId,
				offset: value.offset,
				maxBytes: value.maxBytes,
				encoding: value.encoding,
			};
		case 'artifacts.present':
			return { kind: 'artifact', action: 'present', artifactId: value.artifactId };
		case 'artifacts.checkCapacity':
			return { kind: 'artifact', action: 'capacity', sizeBytes: value.sizeBytes };
		case 'memory.propose':
			return {
				kind: 'memory',
				action: 'propose',
				content: value.content,
				confidence: value.confidence,
				expiresAt: value.expiresAt,
			};
		case 'memory.retrieve':
			return value.action === 'candidates'
				? { kind: 'memory', action: 'candidates', limit: value.limit, offset: value.offset }
				: {
						kind: 'memory',
						action: 'select',
						limit: value.limit,
						candidatesSha256: value.candidatesSha256,
						items: value.items.map((item) => ({ id: item.id, version: item.version, score: item.score })),
					};
		case 'project.bindingRead':
			return { kind: 'project', connectionId: value.connectionId, input: { action: 'read' } };
		case 'project.bindingWrite':
			return {
				kind: 'project',
				connectionId: value.connectionId,
				input: { action: 'write', directory: value.directory },
			};
		case 'remote.inspect':
			return { kind: 'inspect', connectionId: value.connectionId, path: value.path };
		case 'remote.deliver':
			return { kind: 'deliver', connectionId: value.connectionId, paths: value.paths.map((item) => item) };
		case 'docker.inspect':
			return { kind: 'docker_inspect', connectionId: value.connectionId, containerId: value.containerId };
		case 'remote.search':
			return {
				kind: 'search',
				connectionId: value.connectionId,
				path: value.path,
				queries: value.queries.map((query) => query),
				maxResults: value.maxResults,
			};
		case 'remote.write':
			return {
				kind: 'write',
				connectionId: value.connectionId,
				onError: value.onError,
				items: value.items.map((item) => ({
					path: item.path,
					content: item.content,
					expectedSha256: item.expectedSha256,
				})),
			};
		case 'remote.move':
			return {
				kind: 'move',
				connectionId: value.connectionId,
				onError: value.onError,
				items: value.items.map((item) => ({
					path: item.path,
					destinationPath: item.destinationPath,
					expectedFingerprint: item.expectedFingerprint,
				})),
			};
		case 'remote.delete':
			return {
				kind: 'delete',
				connectionId: value.connectionId,
				onError: value.onError,
				items: value.items.map((item) => ({
					path: item.path,
					expectedFingerprint: item.expectedFingerprint,
					scope: item.scope,
				})),
			};
		case 'docker.control':
			return {
				kind: 'docker_control',
				connectionId: value.connectionId,
				onError: value.onError,
				items: value.items.map((item) => ({
					containerId: item.containerId,
					action: item.action,
					expectedFingerprint: item.expectedFingerprint,
				})),
			};
		case 'remote.patch':
			return {
				kind: 'patch',
				connectionId: value.connectionId,
				path: value.path,
				expectedSha256: value.expectedSha256,
				edits: value.edits.map((edit) => ({ oldText: edit.oldText, newText: edit.newText })),
			};
		case 'shell.execute':
			return {
				kind: 'shell',
				connectionId: value.connectionId,
				commands: value.commands.map((command) => command),
				onError: value.onError,
				cwd: value.cwd,
				mode: value.mode,
				yieldSeconds: value.yieldSeconds,
			};
		case 'shell.jobs':
			return {
				kind: 'job',
				connectionId: value.connectionId,
				action: value.action,
				jobIds: value.jobIds.map((id) => id),
				waitMode: value.waitMode,
				waitSeconds: value.waitSeconds,
				offset: value.offset,
			};
		case 'browser.open':
			return {
				kind: 'browser',
				input: { action: 'open', targetId: value.targetId, expectedVersion: value.expectedVersion },
			};
		case 'browser.close':
			return { kind: 'browser', input: { action: 'close', sessionId: value.sessionId } };
		case 'browser.screenshot':
			return { kind: 'browser', input: { action: 'screenshot', sessionId: value.sessionId } };
		case 'browser.console':
			return {
				kind: 'browser',
				input: { action: 'console', sessionId: value.sessionId, after: value.after, limit: value.limit },
			};
		case 'browser.navigate':
			return {
				kind: 'browser',
				input: { action: 'navigate', settleMs: value.settleMs, sessionId: value.sessionId, url: value.url },
			};
		case 'browser.back':
			return { kind: 'browser', input: { action: 'back', settleMs: value.settleMs, sessionId: value.sessionId } };
		case 'browser.scroll':
			return {
				kind: 'browser',
				input: {
					action: 'scroll',
					settleMs: value.settleMs,
					sessionId: value.sessionId,
					deltaX: value.deltaX,
					deltaY: value.deltaY,
				},
			};
		case 'browser.wait':
			return {
				kind: 'browser',
				input: { action: 'wait', sessionId: value.sessionId, mode: value.mode, maxMillis: value.maxMillis },
			};
		case 'browser.click':
			return {
				kind: 'browser',
				input: {
					action: 'click',
					settleMs: value.settleMs,
					sessionId: value.sessionId,
					snapshotId: value.snapshotId,
					nodeRef: value.nodeRef,
				},
			};
		case 'browser.type':
			return {
				kind: 'browser',
				input: {
					action: 'type',
					settleMs: value.settleMs,
					sessionId: value.sessionId,
					snapshotId: value.snapshotId,
					nodeRef: value.nodeRef,
					text: value.text,
				},
			};
		case 'browser.upload':
			return {
				kind: 'browser',
				input: {
					action: 'upload',
					settleMs: value.settleMs,
					sessionId: value.sessionId,
					snapshotId: value.snapshotId,
					nodeRef: value.nodeRef,
					artifactId: value.artifactId,
					expectedVersion: value.expectedVersion,
					sha256: value.sha256,
				},
			};
		case 'browser.download':
			return {
				kind: 'browser',
				input: {
					action: 'download',
					sessionId: value.sessionId,
					snapshotId: value.snapshotId,
					nodeRef: value.nodeRef,
					maxBytes: value.maxBytes,
				},
			};
		case 'browser.snapshot':
			return {
				kind: 'browser',
				input: { action: 'snapshot', sessionId: value.sessionId, maxNodes: value.maxNodes },
			};
		case 'browser.press':
			return {
				kind: 'browser',
				input: {
					action: 'press',
					settleMs: value.settleMs,
					sessionId: value.sessionId,
					key: value.key,
					modifiers: value.modifiers.map((entry) => entry),
					focus:
						value.focus === null
							? null
							: { snapshotId: value.focus.snapshotId, nodeRef: value.focus.nodeRef },
				},
			};
		case 'browser.select':
			return {
				kind: 'browser',
				input: {
					action: 'select',
					settleMs: value.settleMs,
					sessionId: value.sessionId,
					snapshotId: value.snapshotId,
					nodeRef: value.nodeRef,
					values: value.values.map((entry) => entry),
				},
			};
		case 'collaboration.delegate':
			return {
				kind: 'collaboration',
				input: {
					action: 'delegate',
					profile: value.profile,
					objective: value.objective,
					inputJson: value.inputJson,
					targets: value.targets.map((id) => id),
					dependencies: value.dependencies.map((id) => id),
					dependencyMode: value.dependencyMode,
				},
			};
		case 'collaboration.list':
			return { kind: 'collaboration', input: { action: 'list', after: value.after, limit: value.limit } };
		case 'collaboration.readOutput':
			return {
				kind: 'collaboration',
				input: {
					action: 'output_read',
					childId: value.childId,
					offset: value.offset,
					maxBytes: value.maxBytes,
				},
			};
		case 'collaboration.sendMessage':
			return {
				kind: 'collaboration',
				input: {
					action: 'send',
					recipientId: value.recipientId,
					body: value.body,
					ttlSeconds: value.ttlSeconds,
				},
			};
		case 'collaboration.readMessages':
			return { kind: 'collaboration', input: { action: 'read', after: value.after, limit: value.limit } };
		case 'collaboration.consumeMessages':
			return {
				kind: 'collaboration',
				input: { action: 'consume', through: value.through, expectedConsumed: value.expectedConsumed },
			};
		case 'collaboration.readFact':
			return { kind: 'collaboration', input: { action: 'fact_read', key: value.key } };
		case 'collaboration.writeFact':
			return {
				kind: 'collaboration',
				input: {
					action: 'fact_write',
					key: value.key,
					value: value.value,
					expectedVersion: value.expectedVersion,
				},
			};
		case 'collaboration.join':
			return {
				kind: 'collaboration',
				input: {
					action: 'join',
					childIds: value.childIds.map((id) => id),
					mode: value.mode,
					waitSeconds: value.waitSeconds,
				},
			};
		case 'collaboration.cancel':
			return { kind: 'collaboration', input: { action: 'cancel', childIds: value.childIds.map((id) => id) } };
		case 'remote.readTextPage':
		case 'remote.listPage':
			throw new AgentFailure('internal_failure');
	}
}
