import type { ProviderImageRequest, ProviderImageResult } from '../model/provider-types.js';
import { resolveFrozenModel } from '../provider-capability-rules.js';
import { AGENT_PROVIDER_MAX_URL_BYTES } from '@nexus-terminal/shared/agent/providers/values';
import { randomUUID } from 'node:crypto';
import { validateUserId, validateAgentId } from '../../agent-validation.js';
import { AgentFailure, ProviderRequestFailure, isAgentDrainFailure } from '../../agent-failure.js';
import type {
	ProviderInput,
	ProviderView,
	DiscoveredModel,
	ProviderTestResult,
	ProviderPatch,
	AvailableModel,
	ProviderRecord,
} from '../model/provider-types.js';
import { validateProviderInput, normalizeProviderInput } from '../provider-rules.js';
import type { ProviderModel } from '../model/provider-model.js';

function endpoint(base: string): string {
	let url: URL;
	try {
		url = new URL(base);
	} catch {
		throw new AgentFailure('invalid_input');
	}
	if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new AgentFailure('invalid_input');
	}
	return url.toString().replace(/\/$/, '');
}

async function deadline<T>(
	task: (signal: AbortSignal) => Promise<T>,
	signal?: AbortSignal,
	timeoutMs = 10000,
): Promise<T> {
	const controller = new AbortController();

	const onAbort = () => controller.abort();

	if (signal?.aborted) {
		controller.abort();
	} else {
		signal?.addEventListener('abort', onAbort, { once: true });
	}
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		if (controller.signal.aborted) {
			throw new AgentFailure('provider_request_failed');
		}
		const result = await task(controller.signal);
		if (controller.signal.aborted) {
			throw new AgentFailure('provider_request_failed');
		}
		return result;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', onAbort);
	}
}

export class ProviderService {
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private readonly pendingRequests = new Set<Promise<unknown>>();
	private readonly requestFailures: unknown[] = [];
	private excessRequestFailures = 0;

	private readonly active = new Map<string, Set<AbortController>>();

	constructor(
		private readonly model: ProviderModel,
		private readonly revokeDependentRequests: (userId: number, providerId: string) => void,
	) {}

	quiesce(): void {
		this.closing = true;
		for (const requests of this.active.values()) {
			for (const request of requests) {
				request.abort();
			}
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		const requests = [...this.pendingRequests];
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled(requests);
			if (this.requestFailures.length) {
				const causes: unknown[] = [...this.requestFailures];
				if (this.excessRequestFailures) {
					causes.push(new Error(this.excessRequestFailures + ' additional Provider request failures'));
				}
				throw new AggregateError(causes, 'Provider shutdown failed');
			}
		});
		this.quiesce();
		return this.closePromise;
	}

	private key(userId: number, id: string): string {
		return userId + ':' + id;
	}

	private revoke(userId: number, id: string): void {
		for (const request of this.active.get(this.key(userId, id)) ?? []) {
			request.abort();
		}
		this.revokeDependentRequests(userId, id);
	}

	private recordRequestFailure(error: unknown): void {
		const cleanupFailed =
			error instanceof ProviderRequestFailure && error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED';
		if ((!cleanupFailed && !(this.closing && isAgentDrainFailure(error))) || this.requestFailures.includes(error)) {
			return;
		}
		if (this.requestFailures.length < 32) {
			this.requestFailures.push(error);
		} else {
			this.excessRequestFailures++;
		}
	}

	private async guardFailedRequest(provider: ProviderRecord, error: unknown): Promise<void> {
		this.recordRequestFailure(error);
		// Persistence and internal failures must not be replaced by a later state check.
		if (!(error instanceof ProviderRequestFailure)) {
			throw error;
		}
		try {
			await this.model.guardCurrent(provider);
		} catch (guardError) {
			throw new AgentFailure(guardError instanceof AgentFailure ? guardError.code : 'internal_failure', {
				cause: new AggregateError([error, guardError], 'Provider request and state check failed'),
			});
		}
	}

	private async withProviderRequest<T>(
		userId: number,
		id: string,
		outer: AbortSignal | undefined,
		action: (signal: AbortSignal) => Promise<T>,
		timeoutMs = 10000,
	): Promise<T> {
		if (this.closing || this.requestFailures.length) {
			throw new AgentFailure('provider_unavailable');
		}
		const key = this.key(userId, id);
		const controller = new AbortController();

		const abort = () => controller.abort();

		if (outer?.aborted) {
			abort();
		} else {
			outer?.addEventListener('abort', abort, { once: true });
		}
		const running = this.active.get(key) ?? new Set<AbortController>();
		running.add(controller);
		this.active.set(key, running);
		const pending = Promise.resolve().then(() => deadline(action, controller.signal, timeoutMs));
		this.pendingRequests.add(pending);
		try {
			return await pending;
		} catch (error) {
			this.recordRequestFailure(error);
			throw error;
		} finally {
			this.pendingRequests.delete(pending);
			outer?.removeEventListener('abort', abort);
			running.delete(controller);
			if (running.size === 0) {
				this.active.delete(key);
			}
		}
	}

	async list(userId: number): Promise<ProviderView[]> {
		validateUserId(userId);
		return (await this.model.list(userId)).map((provider) => this.model.toView(provider));
	}

	async get(userId: number, id: string): Promise<ProviderView> {
		validateUserId(userId);
		validateAgentId(id);
		const provider = await this.model.get(userId, id);
		if (!provider) {
			throw new AgentFailure('not_found');
		}
		return this.model.toView(provider);
	}

	async create(userId: number, raw: ProviderInput): Promise<ProviderView> {
		validateUserId(userId);
		validateProviderInput(raw);
		const normalized = normalizeProviderInput(raw);
		const input = { ...normalized, baseUrl: endpoint(normalized.baseUrl) };
		validateProviderInput(input);
		if (input.clearCredential) {
			throw new AgentFailure('invalid_input');
		}
		const id = randomUUID();
		const stored = await this.model.create({ userId, id, input, now: Date.now() });
		return this.model.toView(stored);
	}

	async update(userId: number, id: string, expectedVersion: number, raw: ProviderPatch): Promise<ProviderView> {
		validateUserId(userId);
		validateAgentId(id);
		if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
			throw new AgentFailure('invalid_input');
		}
		const current = await this.model.get(userId, id);
		if (!current) {
			throw new AgentFailure('not_found');
		}
		if (current.version !== expectedVersion) {
			throw new AgentFailure('version_conflict');
		}
		const normalized = normalizeProviderInput({
			kind: raw.kind ?? 'openai-compatible',
			displayName: raw.displayName ?? current.displayName,
			baseUrl: raw.baseUrl ?? current.baseUrl,
			protocol: raw.protocol ?? current.protocol,
			models: raw.models ?? current.models,
			enabled: raw.enabled ?? current.enabled,
			...(raw.credential === undefined ? {} : { credential: raw.credential }),
			...(raw.clearCredential === undefined ? {} : { clearCredential: raw.clearCredential }),
		});
		validateProviderInput(normalized);
		const input = { ...normalized, baseUrl: endpoint(normalized.baseUrl) };
		validateProviderInput(input);
		const result = await this.model.update({ userId, id, input, now: Date.now() }, expectedVersion);
		if (result.status !== 'ok') {
			throw new AgentFailure(result.status);
		}
		this.revoke(userId, id);
		return this.model.toView(result.provider);
	}

	async remove(userId: number, id: string, version: number): Promise<void> {
		validateUserId(userId);
		validateAgentId(id);
		if (!Number.isSafeInteger(version) || version < 1) {
			throw new AgentFailure('invalid_input');
		}
		const result = await this.model.remove(userId, id, version, Date.now());
		if (result.status !== 'ok') {
			throw new AgentFailure(result.status);
		}
		this.revoke(userId, id);
	}

	async available(userId: number): Promise<AvailableModel[]> {
		validateUserId(userId);
		const records = await this.model.list(userId);
		return records.flatMap((record) => {
			const view = this.model.toView(record);
			return view.models.flatMap((model) => {
				const frozen = resolveFrozenModel(record, {
					providerId: record.id,
					modelId: model.id,
					configurationVersion: record.version,
				});
				return frozen === null
					? []
					: [
							{
								protocol: frozen.protocol,
								providerId: view.id,
								providerDisplayName: view.displayName,
								configurationVersion: view.version,
								model,
							},
						];
			});
		});
	}

	async discoverEndpoint(
		userId: number,
		baseUrl: string,
		credential?: string,
		signal?: AbortSignal,
	): Promise<DiscoveredModel[]> {
		validateUserId(userId);
		const url = endpoint(baseUrl);
		if (Buffer.byteLength(url, 'utf8') > AGENT_PROVIDER_MAX_URL_BYTES) {
			throw new AgentFailure('invalid_input');
		}
		return this.withProviderRequest(userId, url, signal, (s) => this.model.discover(url, credential ?? null, s));
	}

	async discover(
		userId: number,
		id: string,
		authorizeBeforeWrite: () => Promise<void>,
		signal?: AbortSignal,
	): Promise<DiscoveredModel[]> {
		validateUserId(userId);
		validateAgentId(id);
		const provider = await this.model.get(userId, id);
		if (!provider) {
			throw new AgentFailure('not_found');
		}
		if (!provider.enabled) {
			throw new AgentFailure('provider_unavailable');
		}
		return this.withProviderRequest(userId, id, signal, async (s) => {
			let result: DiscoveredModel[];
			try {
				const credential = await this.model.credential(provider);
				await this.model.guardCurrent(provider);
				if (s.aborted) {
					throw new AgentFailure('provider_configuration_stale');
				}
				result = await this.model.discover(provider.baseUrl, credential, s);
			} catch (error) {
				await this.guardFailedRequest(provider, error);
				if (s.aborted) {
					throw new AgentFailure('provider_configuration_stale');
				}
				if (!(error instanceof ProviderRequestFailure)) {
					throw error;
				}
				throw new AgentFailure('provider_request_failed', { cause: error });
			}
			if (s.aborted) {
				throw new AgentFailure('provider_configuration_stale');
			}
			await authorizeBeforeWrite();
			await this.model.guardCurrent(provider);
			if (s.aborted) {
				throw new AgentFailure('provider_configuration_stale');
			}
			await this.model.recordDiscovery(provider, result);
			return result;
		});
	}

	async imageModels(
		userId: number,
	): Promise<Array<{ providerId: string; configurationVersion: number; modelId: string }>> {
		validateUserId(userId);
		return (await this.model.list(userId))
			.filter((provider) => provider.enabled)
			.flatMap((provider) =>
				provider.models
					.filter((model) => (model.protocol ?? provider.protocol) === 'images')
					.map((model) => ({
						providerId: provider.id,
						configurationVersion: provider.version,
						modelId: model.id,
					})),
			);
	}

	async generateImage(
		userId: number,
		input: ProviderImageRequest,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<ProviderImageResult> {
		validateUserId(userId);
		validateAgentId(input.providerId);
		if (
			!input.prompt.trim() ||
			Buffer.byteLength(input.prompt, 'utf8') > 16000 ||
			!Number.isSafeInteger(input.configurationVersion) ||
			input.configurationVersion < 1 ||
			!input.modelId.trim() ||
			Buffer.byteLength(input.modelId, 'utf8') > 512
		) {
			throw new AgentFailure('invalid_input');
		}
		const provider = await this.model.get(userId, input.providerId);
		if (
			!provider?.enabled ||
			provider.version !== input.configurationVersion ||
			!provider.models.some(
				(model) => model.id === input.modelId && (model.protocol ?? provider.protocol) === 'images',
			)
		) {
			throw new AgentFailure('provider_unavailable');
		}
		return this.withProviderRequest(
			userId,
			provider.id,
			signal,
			async (currentSignal) => {
				try {
					await validate();
					await this.model.guardCurrent(provider);
					if (currentSignal.aborted) {
						throw new AgentFailure('provider_request_failed');
					}
					const result = await this.model.generateImage(provider, input, currentSignal);
					await this.model.guardCurrent(provider);
					await validate();
					return result;
				} catch (error) {
					await this.guardFailedRequest(provider, error);
					throw error;
				}
			},
			300000,
		);
	}

	async test(userId: number, id: string, modelId: string, signal?: AbortSignal): Promise<ProviderTestResult> {
		validateUserId(userId);
		validateAgentId(id);
		const provider = await this.model.get(userId, id);
		if (!provider) {
			throw new AgentFailure('not_found');
		}
		if (!provider.enabled) {
			throw new AgentFailure('provider_unavailable');
		}
		const selected = provider.models.find((m) => m.id === modelId);
		if (!selected) {
			throw new AgentFailure('model_not_found');
		}
		const maxOutputTokens = selected.maxOutputTokens ?? 16;
		const start = Date.now();
		return this.withProviderRequest(
			userId,
			id,
			signal,
			async (s) => {
				try {
					const credential = await this.model.credential(provider);
					await this.model.guardCurrent(provider);
					if (s.aborted) {
						throw new AgentFailure('provider_configuration_stale');
					}
					const result = await this.model.probe(
						{
							baseUrl: provider.baseUrl,
							protocol: selected.protocol ?? provider.protocol,
							modelId: selected.id,
							credential,
							maxOutputTokens,
							usesReasoning: Boolean(selected.reasoningEfforts?.length),
							...(selected.defaultReasoningEffort === undefined
								? {}
								: { reasoningEffort: selected.defaultReasoningEffort }),
						},
						s,
					);
					await this.model.guardCurrent(provider);
					if (s.aborted) {
						throw new AgentFailure('provider_configuration_stale');
					}
					return {
						ok: true,
						latencyMs: Date.now() - start,
						...(result.usage === undefined ? {} : { usage: result.usage }),
					};
				} catch (error) {
					await this.guardFailedRequest(provider, error);
					if (s.aborted) {
						throw new AgentFailure('provider_configuration_stale');
					}
					if (!(error instanceof ProviderRequestFailure)) {
						throw error;
					}
					return { ok: false, latencyMs: Date.now() - start, errorCode: error.errorCode };
				}
			},
			(selected.protocol ?? provider.protocol) === 'images' ? 300000 : 10000,
		);
	}
}
