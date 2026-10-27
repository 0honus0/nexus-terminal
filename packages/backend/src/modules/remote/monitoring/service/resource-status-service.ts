import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { randomUUID } from 'node:crypto';
import { setMaxListeners } from 'node:events';
import type { AccessPublicApi } from '../../../access/public.js';
import type { ObservationModel } from '../model/observation-model.js';
import { observationTargetKey } from '../model/observation-targets.js';
import type { RemoteObservationService } from './observation-service.js';
import { ObservationFailure, type ObservationTarget, type ObservedSshResource } from '../model/observation-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { OBSERVATION_MAX_RESOURCES } from '@nexus-terminal/shared/remote/monitoring/values';
import {
	SETTINGS_MONITORING_MIN_SECONDS,
	SETTINGS_MONITORING_MAX_SECONDS,
} from '@nexus-terminal/shared/preferences/configuration/values';

interface CacheEntry {
	fingerprint: string;
	expiresAt: number;
	value: ObservedSshResource;
}
interface ActiveSample {
	fingerprint: string;
	task: Promise<ObservedSshResource>;
}

/** Dashboard host grouping is application policy; SSH collection is owned by observations. */
export class ResourceStatusService {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly inFlight = new Map<string, Map<string | null, ActiveSample>>();
	private readonly tasks = new Set<Promise<unknown>>();
	private readonly controller = new AbortController();
	private readonly failures = new FailureSummary();
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly model: ObservationModel,
		private readonly observations: RemoteObservationService,
		private refreshSeconds = 60,
	) {
		if (
			!Number.isSafeInteger(refreshSeconds) ||
			refreshSeconds < SETTINGS_MONITORING_MIN_SECONDS ||
			refreshSeconds > SETTINGS_MONITORING_MAX_SECONDS
		) {
			throw new Error('Invalid resource refresh interval');
		}
		setMaxListeners(0, this.controller.signal);
	}

	prepareRefreshInterval(seconds: number): () => void {
		if (
			!Number.isSafeInteger(seconds) ||
			seconds < SETTINGS_MONITORING_MIN_SECONDS ||
			seconds > SETTINGS_MONITORING_MAX_SECONDS
		) {
			throw new Error('Invalid resource refresh interval');
		}
		return () => {
			if (seconds !== this.refreshSeconds) {
				this.refreshSeconds = seconds;
				this.cache.clear();
			}
		};
	}

	private async authorize(token: string | null): Promise<number> {
		if (!this.accepting) {
			throw new ObservationFailure('remote_unavailable');
		}
		const identity = await this.access.authenticate(token);
		if (!identity) {
			throw new ObservationFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new ObservationFailure('forbidden');
		}
		return identity.userId;
	}

	private key(target: ObservationTarget): string {
		return observationTargetKey(target.host, target.port);
	}

	private fingerprint(targets: ObservationTarget[]): string {
		return JSON.stringify(
			targets.map((target) => [
				target.id,
				target.name,
				target.host,
				target.port,
				target.username,
				target.fingerprint,
				target.revision,
			]),
		);
	}

	private async collect(
		token: string | null,
		key: string,
		candidates: ObservationTarget[],
	): Promise<ObservedSshResource> {
		const first = candidates[0];
		if (!first) {
			throw new ObservationFailure('not_found');
		}
		let error: ObservedSshResource['error'] = 'remote_unavailable';
		for (const target of candidates) {
			try {
				const status = await this.observations.collectTarget(
					token,
					target,
					randomUUID(),
					this.controller.signal,
				);
				return {
					key,
					connectionId: target.id,
					name: target.name || target.host,
					username: target.username,
					host: target.host,
					port: target.port,
					status,
					checkedAt: Date.now(),
				};
			} catch (cause) {
				if (cause instanceof RemoteResourceCleanupFailure) {
					throw cause;
				}
				if (
					cause instanceof ObservationFailure &&
					(cause.code === 'unauthenticated' || cause.code === 'forbidden' || cause.code === 'limit_exceeded')
				) {
					throw cause;
				}
				error = cause instanceof ObservationFailure ? cause.code : 'remote_unavailable';
			}
		}
		return {
			key,
			connectionId: first.id,
			name: first.name || first.host,
			username: first.username,
			host: first.host,
			port: first.port,
			error,
			checkedAt: Date.now(),
		};
	}

	private cached(token: string | null, key: string, candidates: ObservationTarget[]): Promise<ObservedSshResource> {
		const fingerprint = this.fingerprint(candidates);
		const cached = this.cache.get(key);
		if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
			return Promise.resolve(cached.value);
		}
		const sessions = this.inFlight.get(key) ?? new Map<string | null, ActiveSample>();
		const active = sessions.get(token);
		if (active?.fingerprint === fingerprint) {
			return active.task;
		}
		const entry: ActiveSample = {
			fingerprint,
			task: Promise.resolve().then(() => this.collect(token, key, candidates)),
		};
		sessions.set(token, entry);
		this.inFlight.set(key, sessions);
		const task = entry.task
			.then((value) => {
				if (
					this.accepting &&
					this.inFlight.get(key) === sessions &&
					sessions.get(token) === entry &&
					value.error === undefined
				) {
					this.cache.set(key, { fingerprint, value, expiresAt: Date.now() + this.refreshSeconds * 1000 });
				}
				return value;
			})
			.catch((error) => {
				if (error instanceof RemoteResourceCleanupFailure) {
					this.failures.record(error);
				}
				throw error;
			})
			.finally(() => {
				if (this.inFlight.get(key) === sessions && sessions.get(token) === entry) {
					sessions.delete(token);
					if (!sessions.size) {
						this.inFlight.delete(key);
					}
				}
				this.tasks.delete(task);
			});
		entry.task = task;
		this.tasks.add(task);
		return task;
	}

	list(token: string | null, connectionId?: number, signal?: AbortSignal): Promise<ObservedSshResource[]> {
		if (!this.accepting) {
			throw new ObservationFailure('remote_unavailable');
		}
		const controller = new AbortController();

		const abort = () => controller.abort(new ObservationFailure('remote_unavailable'));

		this.controller.signal.addEventListener('abort', abort, { once: true });
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		const timer = setTimeout(abort, 120000);
		timer.unref();
		const task = Promise.resolve()
			.then(() => this.listOwned(token, controller.signal, connectionId))
			.finally(() => {
				clearTimeout(timer);
				this.controller.signal.removeEventListener('abort', abort);
				signal?.removeEventListener('abort', abort);
				this.tasks.delete(task);
			});
		this.tasks.add(task);
		return this.wait(task, controller.signal);
	}

	private wait<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const abort = () => reject(signal.reason);

			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
			}
			void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
		});
	}

	private async listOwned(
		token: string | null,
		signal: AbortSignal,
		connectionId?: number,
	): Promise<ObservedSshResource[]> {
		const userId = await this.authorize(token);
		const targets = await this.model.listTargets(signal, connectionId);
		signal.throwIfAborted();
		const groups = new Map<string, ObservationTarget[]>();
		for (const target of targets) {
			const key = this.key(target);
			const group = groups.get(key) ?? [];
			group.push(target);
			groups.set(key, group);
		}
		if (groups.size > OBSERVATION_MAX_RESOURCES) {
			throw new ObservationFailure('limit_exceeded');
		}
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (entry.expiresAt <= now || (connectionId === undefined && !groups.has(key))) {
				this.cache.delete(key);
			}
		}
		// A targeted refresh is only a partial catalog; preserve unrelated live samples/tasks.
		if (connectionId === undefined) {
			for (const key of this.inFlight.keys()) {
				if (!groups.has(key)) {
					this.inFlight.delete(key);
				}
			}
		}
		let entries = [...groups.entries()];
		if (connectionId !== undefined) {
			const selected = targets.find((target) => target.id === connectionId);
			if (!selected) {
				throw new ObservationFailure('not_found');
			}
			entries = entries.filter(([key]) => key === this.key(selected));
		}
		const results: ObservedSshResource[] = [];
		let index = 0;

		const worker = async () => {
			while (index < entries.length) {
				signal.throwIfAborted();
				const entry = entries[index++];
				if (entry) {
					results.push(await this.wait(this.cached(token, entry[0], entry[1]), signal));
				}
			}
		};

		const outcomes = await Promise.allSettled(Array.from({ length: Math.min(2, entries.length) }, worker));
		const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
		if (failures.length) {
			if (failures.length > 1) {
				const causes = failures.map((failure) => failure.reason);
				if (causes.some((cause) => cause instanceof RemoteResourceCleanupFailure)) {
					throw new RemoteResourceCleanupFailure(causes);
				}
				const first = causes[0];
				const code =
					first instanceof ObservationFailure &&
					causes.every((cause) => cause instanceof ObservationFailure && cause.code === first.code)
						? first.code
						: 'remote_unavailable';
				throw new ObservationFailure(code, { cause: new AggregateError(causes) });
			}
			throw failures[0]?.reason;
		}
		if ((await this.authorize(token)) !== userId) {
			throw new ObservationFailure('unauthenticated');
		}
		const latest = await this.model.listTargets(signal, undefined, new Set(entries.map(([key]) => key)));
		signal.throwIfAborted();
		const latestGroups = new Map<string, ObservationTarget[]>();
		for (const target of latest) {
			const key = this.key(target);
			const group = latestGroups.get(key) ?? [];
			group.push(target);
			latestGroups.set(key, group);
		}
		for (const [key, candidates] of entries) {
			if (this.fingerprint(latestGroups.get(key) ?? []) !== this.fingerprint(candidates)) {
				throw new ObservationFailure('conflict');
			}
		}
		if ((await this.authorize(token)) !== userId) {
			throw new ObservationFailure('unauthenticated');
		}
		signal.throwIfAborted();
		return results.sort((a, b) => a.name.localeCompare(b.name) || a.host.localeCompare(b.host) || a.port - b.port);
	}

	clearCache(): void {
		this.cache.clear();
		this.inFlight.clear();
	}

	quiesce(): void {
		this.accepting = false;
		this.controller.abort();
		this.clearCache();
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.accepting = false;
		this.closePromise = Promise.resolve().then(async () => {
			this.quiesce();
			await Promise.allSettled([...this.tasks]);
			const failures = this.failures.errors();
			if (failures.length) {
				throw new RemoteResourceCleanupFailure(failures);
			}
		});
		return this.closePromise;
	}
}
