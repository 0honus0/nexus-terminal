import type { ToolContentInput } from '../model/tool-perform-types.js';
import type { HostOperationResult } from '../model/host-operation-result.js';
import type { HostEffect } from '../model/host-execution-types.js';
import type { ResultService } from '../../context/service/result-service.js';
import type { MemoryService } from '../../memory/service/memory-service.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ProviderService } from '../../providers/service/provider-service.js';
import type { ProviderImageService } from '../../providers/service/provider-image-service.js';
import { AgentFailure } from '../../agent-failure.js';

type ToolContentResult = Extract<
	HostOperationResult,
	{
		operation:
			| 'images.list'
			| 'images.generate'
			| 'context.readResults'
			| 'artifacts.checkCapacity'
			| 'artifacts.create'
			| 'artifacts.read'
			| 'artifacts.present'
			| 'memory.propose'
			| 'memory.retrieve';
	}
> & { targets: { id: number; version: number }[]; outputArtifactIds?: string[] };

/** Domain operations retain exact caller identity, storage admission and cancellation. */
export class ToolContentService {
	constructor(
		private readonly results: ResultService,
		private readonly memory: MemoryService,
		private readonly artifacts: ArtifactService,
		private readonly providers: ProviderService,
		private readonly images: ProviderImageService,
	) {}

	async imageModels(userId: number): Promise<Extract<HostOperationResult, { operation: 'images.list' }>> {
		return { operation: 'images.list', value: { models: await this.providers.imageModels(userId) } };
	}

	async perform(
		input: Exclude<ToolContentInput, { kind: 'checkpoint' }>,
		operation: HostEffect,
		revision: number,
		signal: AbortSignal,
		previewBytes: number,
		validate: () => Promise<void>,
		recordOutputArtifacts: (ids: readonly string[]) => void,
	): Promise<ToolContentResult> {
		const actor = {
			kind: 'tool' as const,
			userId: operation.userId,
			appId: operation.appId,
			runId: operation.runId,
			operationId: operation.id,
			operationHash: operation.operationHash,
		};
		await validate();
		if (input.kind === 'image_models') {
			const models = await this.providers.imageModels(operation.userId);
			await validate();
			return { operation: 'images.list', value: { models }, targets: [] };
		}
		if (input.kind === 'image_generate') {
			const result = await this.images.generate(actor, input.input, signal, validate, recordOutputArtifacts);
			await validate();
			return {
				operation: 'images.generate',
				value: { id: result.id, name: result.name, sizeBytes: result.sizeBytes },
				targets: [],
				outputArtifactIds: [result.id],
			};
		}
		if (input.kind === 'artifact') {
			if (input.action === 'capacity') {
				if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
					throw new AgentFailure('invalid_input');
				}
				const availableBytes = await this.artifacts.availableBytes(actor, 0);
				if (input.sizeBytes > availableBytes) {
					throw new AgentFailure('limit_exceeded');
				}
				await validate();
				return { operation: 'artifacts.checkCapacity', value: { availableBytes }, targets: [] };
			}
			if (input.action === 'create') {
				const bytes = Buffer.from(input.base64, 'base64');
				if (bytes.toString('base64') !== input.base64) {
					throw new AgentFailure('invalid_input');
				}
				const pending = await this.artifacts.begin(actor, {
					name: input.name,
					mediaType: input.mediaType,
					declaredBytes: bytes.byteLength,
				});

				async function* source(): AsyncIterable<Uint8Array> {
					yield bytes;
				}

				const saved = await this.artifacts.upload(
					actor,
					pending.id,
					pending.version,
					source(),
					signal,
					recordOutputArtifacts,
				);
				await validate();
				return {
					operation: 'artifacts.create',
					value: {
						id: saved.id,
						version: saved.version,
						status: saved.status,
						sizeBytes: saved.sizeBytes,
						sha256: saved.sha256,
					},
					targets: [],
					outputArtifactIds: [saved.id],
				};
			}
			if (input.action === 'present') {
				const saved = await this.artifacts.presentTool(actor, input.artifactId);
				recordOutputArtifacts([saved.id]);
				await validate();
				return {
					operation: 'artifacts.present',
					value: { id: saved.id, name: saved.name, sizeBytes: saved.sizeBytes },
					targets: [],
					outputArtifactIds: [saved.id],
				};
			}
			const page = await this.artifacts.readTool(
				actor,
				input.artifactId,
				input.offset,
				input.maxBytes,
				signal,
				input.encoding,
			);
			await validate();
			return {
				operation: 'artifacts.read',
				value: {
					id: page.id,
					sha256: page.sha256,
					sizeBytes: page.sizeBytes,
					offset: page.offset,
					nextOffset: page.nextOffset,
					encoding: input.encoding,
					base64: page.base64,
					text: page.text,
				},
				targets: [],
			};
		}
		if (input.kind === 'memory') {
			if (input.action === 'propose') {
				const saved = await this.memory.propose(actor, {
					content: input.content,
					confidence: input.confidence,
					expiresAt: input.expiresAt,
					sourceRunId: operation.runId,
				});
				await validate();
				return {
					operation: 'memory.propose',
					value: { id: saved.id, status: saved.status, version: saved.version },
					targets: [],
				};
			}
			if (input.action === 'select') {
				const selected = await this.memory.select(actor, {
					limit: input.limit,
					candidatesSha256: input.candidatesSha256,
					items: input.items.map((item) => ({ id: item.id, version: item.version, score: item.score })),
				});
				await validate();
				return {
					operation: 'memory.retrieve',
					value: {
						action: 'select',
						items: selected.map((memory) => ({
							id: memory.id,
							version: memory.version,
							content: memory.content,
							confidence: memory.confidence,
							score: memory.score,
						})),
					},
					targets: [],
				};
			}
			const page = await this.memory.candidates(actor, { limit: input.limit, offset: input.offset });
			await validate();
			return {
				operation: 'memory.retrieve',
				value: {
					action: 'candidates',
					items: page.items.map((memory) => ({
						id: memory.id,
						version: memory.version,
						content: memory.content,
						confidence: memory.confidence,
					})),
					nextOffset: page.nextOffset,
					candidatesSha256: page.candidatesSha256,
					maxItems: page.maxItems,
					maxBytes: page.maxBytes,
				},
				targets: [],
			};
		}
		const result = await this.results.read(input.item, operation, revision, previewBytes, signal);
		await validate();
		return {
			operation: 'context.readResults',
			value: {
				toolCallId: result.page.toolCallId,
				sha256: result.page.sha256,
				originalBytes: result.page.originalBytes,
				offset: result.page.offset,
				nextOffset: result.page.nextOffset,
				text: result.page.text,
			},
			targets: result.targets.map((target) => ({ id: target.id, version: target.version })),
		};
	}
}
