import { createHash } from 'node:crypto';
import { AGENT_APPROVAL_MAX_SUMMARY_BYTES } from '@nexus-terminal/shared/agent/governance/values';
import { AgentFailure } from '../../agent-failure.js';
import type { HostToolCommand } from '../model/host-tool-command.js';
import type { HostOperationDefinition } from '../model/tool-types.js';

function summaryWithCommand(base: Record<string, unknown>, command: string): string {
	const characters = Array.from(command);

	const build = (length: number) =>
		JSON.stringify({
			...base,
			command: characters.slice(0, length).join(''),
			commandTruncated: length < characters.length,
		});

	const complete = build(characters.length);
	if (Buffer.byteLength(complete, 'utf8') <= AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
		return complete;
	}
	let low = 0;
	let high = characters.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(build(middle), 'utf8') <= AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return build(low);
}

export function hostOperationSummary(input: HostToolCommand, trusted: HostOperationDefinition): string {
	const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

	let summary: string;
	if (input.kind === 'collaboration') {
		const command = input.input;
		if (command.action === 'delegate') {
			summary = summaryWithCommand(
				{
					action: 'delegate',
					profile: command.profile,
					targets: command.targets.map((id) => id),
					dependencies: command.dependencies.slice(0, 8),
					dependencyCount: command.dependencies.length,
					dependenciesTruncated: command.dependencies.length > 8,
					dependenciesSha256: hash(JSON.stringify(command.dependencies)),
					dependencyMode: command.dependencyMode,
					objectiveBytes: Buffer.byteLength(command.objective, 'utf8'),
					objectiveSha256: hash(command.objective),
				},
				command.objective,
			);
		} else if (command.action === 'send' || command.action === 'fact_write') {
			const text = command.action === 'send' ? command.body : command.value;
			summary = summaryWithCommand(
				command.action === 'send'
					? {
							action: 'collaboration_send',
							recipientId: command.recipientId,
							ttlSeconds: command.ttlSeconds,
							bytes: Buffer.byteLength(text, 'utf8'),
							sha256: hash(text),
						}
					: {
							action: 'collaboration_fact_write',
							key: command.key,
							expectedVersion: command.expectedVersion,
							bytes: Buffer.byteLength(text, 'utf8'),
							sha256: hash(text),
						},
				text,
			);
		} else if (command.action === 'cancel') {
			summary = summaryWithCommand(
				{
					action: 'collaboration_cancel',
					childCount: command.childIds.length,
					sha256: hash(JSON.stringify(command.childIds)),
				},
				command.childIds.join('\n'),
			);
		} else if (command.action === 'consume') {
			summary = JSON.stringify({
				action: 'collaboration_consume',
				through: command.through,
				expectedConsumed: command.expectedConsumed,
			});
		} else {
			return trusted.name;
		}
	} else if (input.kind === 'artifact' && input.action === 'create') {
		summary = JSON.stringify({
			action: 'artifact_create',
			name: input.name,
			mediaType: input.mediaType,
			bytes: Buffer.from(input.base64, 'base64').byteLength,
			sha256: createHash('sha256').update(Buffer.from(input.base64, 'base64')).digest('hex'),
		});
	} else if (input.kind === 'memory' && input.action === 'propose') {
		summary = summaryWithCommand(
			{
				action: 'memory_propose',
				confidence: input.confidence,
				expiresAt: input.expiresAt,
				bytes: Buffer.byteLength(input.content, 'utf8'),
				sha256: hash(input.content),
			},
			input.content,
		);
	} else if (input.kind === 'browser') {
		const command = input.input;
		const action = 'browser_' + command.action;
		if (command.action === 'type') {
			summary = summaryWithCommand(
				{
					action,
					sessionId: command.sessionId,
					snapshotId: command.snapshotId,
					nodeRef: command.nodeRef,
					bytes: Buffer.byteLength(command.text, 'utf8'),
					sha256: hash(command.text),
				},
				command.text,
			);
		} else if (command.action === 'navigate') {
			summary = summaryWithCommand({ action, sessionId: command.sessionId }, command.url);
		} else if (command.action === 'select') {
			summary = summaryWithCommand(
				{ action, sessionId: command.sessionId, snapshotId: command.snapshotId, nodeRef: command.nodeRef },
				JSON.stringify(command.values),
			);
		} else if (command.action === 'open') {
			summary = JSON.stringify({ action, targetId: command.targetId, expectedVersion: command.expectedVersion });
		} else if (command.action === 'press') {
			summary = JSON.stringify({
				action,
				sessionId: command.sessionId,
				key: command.key,
				modifiers: command.modifiers.map((modifier) => modifier),
				snapshotId: command.focus?.snapshotId ?? null,
				nodeRef: command.focus?.nodeRef ?? null,
			});
		} else if (command.action === 'upload') {
			summary = JSON.stringify({
				action,
				sessionId: command.sessionId,
				snapshotId: command.snapshotId,
				nodeRef: command.nodeRef,
				artifactId: command.artifactId,
				expectedVersion: command.expectedVersion,
				sha256: command.sha256,
			});
		} else if (command.action === 'click' || command.action === 'download') {
			summary = JSON.stringify({
				action,
				sessionId: command.sessionId,
				snapshotId: command.snapshotId,
				nodeRef: command.nodeRef,
			});
		} else if (command.action === 'scroll') {
			summary = JSON.stringify({
				action,
				sessionId: command.sessionId,
				deltaX: command.deltaX,
				deltaY: command.deltaY,
			});
		} else {
			summary = JSON.stringify({ action, sessionId: command.sessionId });
		}
	} else if (input.kind === 'image_generate') {
		summary = summaryWithCommand(
			{
				action: 'image_generate',
				providerId: input.input.providerId,
				configurationVersion: input.input.configurationVersion,
				modelId: input.input.modelId,
				promptBytes: Buffer.byteLength(input.input.prompt),
				promptSha256: hash(input.input.prompt),
			},
			input.input.prompt,
		);
	} else if (input.kind === 'shell') {
		const command = JSON.stringify(input.commands);
		summary = summaryWithCommand(
			{
				action: 'execute',
				mode: input.mode,
				commandCount: input.commands.length,
				onError: input.onError,
				cwd: input.cwd,
				bytes: Buffer.byteLength(command, 'utf8'),
				sha256: hash(command),
			},
			input.commands.map((command, index) => `${index + 1}. ${command}`).join('\n'),
		);
	} else if (input.kind === 'project') {
		summary = JSON.stringify({
			action: input.input.action,
			connectionId: input.connectionId,
			directory: input.input.action === 'write' ? input.input.directory : null,
		});
	} else if (input.kind === 'deliver') {
		summary = summaryWithCommand(
			{ action: 'deliver', itemCount: input.paths.length, sha256: hash(JSON.stringify(input.paths)) },
			input.paths.join('\n'),
		);
	} else if (input.kind === 'job') {
		summary = summaryWithCommand(
			{
				action: input.action,
				jobCount: input.jobIds.length,
				waitMode: input.waitMode,
				sha256: hash(JSON.stringify(input.jobIds)),
			},
			input.jobIds.join('\n'),
		);
	} else if (
		input.kind === 'docker_control' ||
		input.kind === 'write' ||
		input.kind === 'move' ||
		input.kind === 'delete'
	) {
		summary = summaryWithCommand(
			{
				action: input.kind,
				itemCount: input.items.length,
				onError: input.onError,
				sha256: hash(JSON.stringify(input.items)),
			},
			input.items
				.map((item) =>
					'containerId' in item
						? item.action + ' ' + item.containerId
						: 'destinationPath' in item
							? item.path + ' → ' + item.destinationPath
							: 'content' in item
								? item.path + ' (' + Buffer.byteLength(item.content, 'utf8') + ' bytes)'
								: item.path + ' (' + item.scope + ')',
				)
				.join('\n'),
		);
	} else if (input.kind === 'patch') {
		summary = JSON.stringify({
			action: 'patch',
			path: input.path,
			expectedSha256: input.expectedSha256,
			editCount: input.edits.length,
			editsSha256: hash(JSON.stringify(input.edits)),
		});
	} else {
		return trusted.name;
	}

	if (Buffer.byteLength(summary, 'utf8') > AGENT_APPROVAL_MAX_SUMMARY_BYTES) {
		throw new AgentFailure('limit_exceeded');
	}
	return summary;
}
