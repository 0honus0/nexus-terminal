import type { ConnectionService } from '../connections/connection.service';
import { randomUUID } from 'node:crypto';
import type { SshConnectionResolver } from '../connections/services/ssh-connection-resolver.service';
import type { SettingsService } from '../settings/settings.service';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { ServerStatus, ServerStatusCollector } from '../../platform/system/server-status.port';
export interface SshResourceStatus {
	key: string;
	connectionId: number;
	name: string;
	username: string;
	host: string;
	port: number;
	status?: ServerStatus;
	error?: string;
	checkedAt: number;
}

const keyFor = (host: string, port: number) => `${host.trim().toLowerCase()}:${port}`;

const RESOURCE_CONNECT_TIMEOUT_MS = 5_000;
const RESOURCE_BOOTSTRAP_SAMPLE_DELAY_MS = 500;

const wait = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export class SshResourceStatusService {
	private readonly cache = new Map<string, { fingerprint: string; expiresAt: number; value: SshResourceStatus }>();
	private readonly inFlight = new Map<string, { fingerprint: string; promise: Promise<SshResourceStatus> }>();
	private readonly bootstrappedKeys = new Set<string>();

	constructor(
		private readonly connections: ConnectionService,
		private readonly resolver: SshConnectionResolver,
		private readonly sessions: ExecutionSessionManager,
		private readonly collector: ServerStatusCollector,
		private readonly settings: SettingsService,
	) {}

	async getSshResourceStatuses() {
		const all = (await this.connections.list()).filter((c) => c.type === 'SSH');
		this.pruneHosts(new Set(all.map((c) => keyFor(c.host, c.port))));
		const refresh = await this.settings.getRemoteHostRefreshIntervalSeconds();
		const groups = new Map<string, typeof all>();
		for (const c of all) {
			const key = keyFor(c.host, c.port);
			const arr = groups.get(key) ?? [];
			arr.push(c);
			groups.set(key, arr);
		}
		return this.collectGroups(groups, refresh);
	}

	async getSshResourceStatus(connectionId: number): Promise<SshResourceStatus | null> {
		const all = (await this.connections.list()).filter((c) => c.type === 'SSH');
		this.pruneHosts(new Set(all.map((c) => keyFor(c.host, c.port))));
		const selected = all.find((c) => c.id === connectionId);
		if (!selected) return null;
		const key = keyFor(selected.host, selected.port);
		const candidates = all.filter((c) => keyFor(c.host, c.port) === key);
		const refresh = await this.settings.getRemoteHostRefreshIntervalSeconds();
		return this.collectCachedHost(key, candidates, refresh);
	}

	clearCache() {
		this.cache.clear();
		this.inFlight.clear();
		this.bootstrappedKeys.clear();
	}

	private pruneHosts(keys: Set<string>): void {
		for (const key of this.cache.keys()) if (!keys.has(key)) this.cache.delete(key);
		for (const key of this.inFlight.keys()) if (!keys.has(key)) this.inFlight.delete(key);
	}

	private collectCachedHost(
		key: string,
		candidates: Awaited<ReturnType<ConnectionService['list']>>,
		refresh: number,
	): Promise<SshResourceStatus> {
		const fingerprint = `${candidates.map((c) => [c.id, c.updatedAt, c.host, c.port, c.username, c.authMethod, c.proxyId, c.route, c.jumpChain?.join(',') ?? ''].join('\u001f')).join('\u001e')}\u001d${refresh}`;
		const cached = this.cache.get(key);
		if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
		const active = this.inFlight.get(key);
		if (active?.fingerprint === fingerprint) return active.promise;
		const startedAt = Date.now();
		const sampleKey = `${key}:${randomUUID()}`;
		const promise = this.collectHost(sampleKey, candidates)
			.then((value) => ({ ...value, key }))
			.finally(() => {
				this.bootstrappedKeys.delete(sampleKey);
				this.collector.clear(sampleKey);
			});
		this.inFlight.set(key, { fingerprint, promise });
		void promise
			.then((value) => {
				if (this.inFlight.get(key)?.promise === promise)
					this.cache.set(key, {
						fingerprint,
						expiresAt: startedAt + Math.max(1000, refresh * 1000),
						value,
					});
			})
			.finally(() => {
				if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
			})
			.catch(() => undefined);
		return promise;
	}

	private async collectGroups(groups: Map<string, Awaited<ReturnType<ConnectionService['list']>>>, refresh: number) {
		const entries = [...groups.entries()];
		const results = new Array<SshResourceStatus>(entries.length);
		let next = 0;

		const worker = async () => {
			while (next < entries.length) {
				const index = next++;
				const entry = entries[index];
				if (entry) results[index] = await this.collectCachedHost(entry[0], entry[1], refresh);
			}
		};

		await Promise.all(Array.from({ length: Math.min(2, entries.length) }, worker));
		return results.sort((a, b) => a.name.localeCompare(b.name) || a.host.localeCompare(b.host) || a.port - b.port);
	}

	private async collectHost(key: string, candidates: Awaited<ReturnType<ConnectionService['list']>>) {
		const representative = candidates[0]!;
		let lastError = 'Unable to collect SSH resource status.';
		const activeWorkspaceSessions = this.sessions
			.snapshot()
			.filter((session) => session.ownerType === 'workspace' && session.status === 'ready');
		for (const candidate of candidates) {
			const identity = activeWorkspaceSessions.find((session) => session.connectionId === candidate.id);
			const session = identity ? this.sessions.get(identity.id) : undefined;
			if (!session?.isReady) continue;
			try {
				let status = await this.collector.collect(session, key);
				if (!this.bootstrappedKeys.has(key)) {
					await wait(RESOURCE_BOOTSTRAP_SAMPLE_DELAY_MS);
					status = await this.collector.collect(session, key);
					this.bootstrappedKeys.add(key);
				}
				return {
					key,
					connectionId: candidate.id,
					name: candidate.name || candidate.host,
					username: candidate.username,
					host: candidate.host,
					port: candidate.port,
					status,
					checkedAt: Date.now(),
				};
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
			}
		}
		for (const candidate of candidates) {
			let sessionId: string | undefined;
			try {
				const connection = await this.resolver.resolveStored(candidate.id);
				const session = await this.sessions.connect({
					ownerType: 'system',
					ownerId: `resource:${key}`,
					connection,
					// Resource sampling opens a real SSH transport, but it is background polling rather
					// than a user-visible connection and must not update the dashboard's recent-connection time.
					connect: { timeoutMs: RESOURCE_CONNECT_TIMEOUT_MS, suppressConnectedHook: true },
				});
				sessionId = session.id;
				let status = await this.collector.collect(session, key);
				if (!this.bootstrappedKeys.has(key)) {
					await wait(RESOURCE_BOOTSTRAP_SAMPLE_DELAY_MS);
					status = await this.collector.collect(session, key);
					this.bootstrappedKeys.add(key);
				}
				return {
					key,
					connectionId: candidate.id,
					name: candidate.name || candidate.host,
					username: candidate.username,
					host: candidate.host,
					port: candidate.port,
					status,
					checkedAt: Date.now(),
				};
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
			} finally {
				if (sessionId) await this.sessions.close(sessionId).catch(() => undefined);
			}
		}
		return {
			key,
			connectionId: representative.id,
			name: representative.name || representative.host,
			username: representative.username,
			host: representative.host,
			port: representative.port,
			error: lastError,
			checkedAt: Date.now(),
		};
	}
}
