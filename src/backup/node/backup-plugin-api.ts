import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { z } from 'zod';
import hostPackage from '../../../package.json' with { type: 'json' };
import { HttpFailure } from '../../http/node/http-plugin-api.js';
import type { MarketplacePlugin } from '../../marketplace/node/marketplace-plugin-api.js';
import { MarketplacePluginId } from '../../marketplace/marketplace-types.js';
import type { BuiltinPlugin, PluginContextApi } from '../../plugin/plugin-api.node.js';
import {
	BackupFileSchema,
	BackupImportSchema,
	BackupJobSchema,
	BackupPasswordSchema,
	BackupPlanSchema,
	BackupRestoreSchema,
	BackupRestoreIssueSchema,
	BackupStatusSchema,
	BackupStatusTopic,
} from '../backup-http-types.js';
import { BackupPluginId } from '../backup-types.js';
import { backupDataLimit, type BackupDataApi } from './backup-data-api.js';
import { CodedError } from '../../utils/error.js';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const archiveContext = 'nexus.backup.v1';
const empty = z.strictObject({});

function digest(payload: string): string {
	return createHash('sha256').update(payload).digest('hex');
}

function ownersOf(entries: readonly { pluginId: string; pluginVersion: string }[]) {
	return [...new Map(entries.map(({ pluginId, pluginVersion }) => [pluginId, { pluginId, pluginVersion }])).values()];
}

function restoreIssue(cause: unknown) {
	return BackupRestoreIssueSchema.safeParse(cause instanceof CodedError ? cause.code : undefined).data;
}

export class BackupPlugin implements BuiltinPlugin {
	readonly id = BackupPluginId;
	readonly version = hostPackage.version;
	readonly dependsOn = { [MarketplacePluginId]: hostPackage.version };
	readonly #data: BackupDataApi;
	readonly #marketplace: Pick<MarketplacePlugin, 'describeBackup' | 'planBackup' | 'restoreBackup'>;

	constructor(
		data: BackupDataApi,
		marketplace: Pick<MarketplacePlugin, 'describeBackup' | 'planBackup' | 'restoreBackup'>,
	) {
		this.#data = data;
		this.#marketplace = marketplace;
	}

	activate(context: PluginContextApi): void {
		const { crypto, http, log, state } = context.app;
		const publisher = state.register({
			name: BackupStatusTopic.name,
			schema: BackupJobSchema,
			initial: { job: null },
		});
		let status: z.infer<typeof BackupStatusSchema> | null = null;
		let pending: Promise<void> | undefined;
		let preview:
			| {
					token: string;
					digest: string;
					expires: number;
					marketplace: Awaited<ReturnType<MarketplacePlugin['planBackup']>>;
			  }
			| undefined;
		context.onDispose(async () => pending);

		const report = (code: string) => log.report({ level: 'warn', code });

		const decode = async (file: z.infer<typeof BackupFileSchema>, password: string, signal: AbortSignal) => {
			const result = await crypto.decrypt(Buffer.from(file.payload, 'base64'), {
				mode: 'password',
				password,
				context: archiveContext,
			});
			if (result.isErr()) {
				signal.throwIfAborted();
				throw new HttpFailure(400, 'BACKUP_DECRYPT_FAILED');
			}
			try {
				signal.throwIfAborted();
				const json = await decompress(result.value, { maxOutputLength: backupDataLimit });
				try {
					signal.throwIfAborted();
					return this.#data.parse(JSON.parse(json.toString('utf8')));
				} finally {
					json.fill(0);
				}
			} catch {
				signal.throwIfAborted();
				throw new HttpFailure(400, 'BACKUP_FILE_INVALID');
			} finally {
				result.value.fill(0);
			}
		};

		http.register([
			{
				method: 'post',
				path: '/export',
				input: BackupPasswordSchema,
				output: BackupFileSchema,

				handler: async ({ password }: z.infer<typeof BackupPasswordSchema>, signal) => {
					if (pending) throw new HttpFailure(409, 'BACKUP_BUSY');
					const scope = { signal, onDispose: context.onDispose };
					const archive = await this.#data.export(scope).catch((cause: unknown) => {
						if (cause instanceof CodedError && cause.code === 'BACKUP_TOO_LARGE')
							throw new HttpFailure(413, 'BACKUP_TOO_LARGE');
						throw cause;
					});
					const packages = await this.#marketplace
						.describeBackup(
							ownersOf(archive.entries).filter(({ pluginId }) => !this.#data.isHostOwner(pluginId)),
							signal,
						)
						.catch((cause: unknown) => {
							const issue = restoreIssue(cause);
							if (issue) throw new HttpFailure(409, issue);
							throw cause;
						});
					const json = Buffer.from(JSON.stringify({ ...archive, packages }), 'utf8');
					let compressed: Buffer | undefined;
					try {
						if (json.length > backupDataLimit) throw new HttpFailure(413, 'BACKUP_TOO_LARGE');
						compressed = await compress(json);
						signal.throwIfAborted();
						const result = await crypto.encrypt(compressed, {
							mode: 'password',
							password,
							context: archiveContext,
						});
						signal.throwIfAborted();
						if (result.isErr()) throw new HttpFailure(500, 'BACKUP_EXPORT_FAILED');
						const payload = Buffer.from(result.value).toString('base64');
						if (payload.length > 1_800_000) throw new HttpFailure(413, 'BACKUP_TOO_LARGE');
						return { format: 1 as const, payload };
					} finally {
						json.fill(0);
						compressed?.fill(0);
					}
				},
			},
			{
				method: 'post',
				path: '/preview',
				input: BackupImportSchema,
				output: BackupPlanSchema,

				handler: async ({ file, password }: z.infer<typeof BackupImportSchema>, signal) => {
					if (pending) throw new HttpFailure(409, 'BACKUP_BUSY');
					const archive = await decode(file, password, signal);
					try {
						const marketplace = await this.#marketplace.planBackup(
							ownersOf(archive.entries).filter(({ pluginId }) => !this.#data.isHostOwner(pluginId)),
							archive.packages ?? [],
							signal,
						);
						const installs = marketplace.installs.map(({ step }) => ({
							pluginId: step.package.name,
							version: step.package.version,
							repository: step.repository.label,
						}));
						const missing = new Set(installs.map(({ pluginId }) => pluginId));
						const plan = await this.#data.preview(
							archive,
							{ signal, onDispose: context.onDispose },
							missing,
						);
						signal.throwIfAborted();
						if (pending) throw new HttpFailure(409, 'BACKUP_BUSY');
						const token = randomUUID();
						preview = {
							token,
							digest: digest(file.payload),
							expires: Date.now() + 5 * 60_000,
							marketplace,
						};
						return { ...plan, installs, token };
					} catch (cause) {
						signal.throwIfAborted();
						if (cause instanceof HttpFailure) throw cause;
						const issue = restoreIssue(cause);
						if (issue) throw new HttpFailure(409, issue);
						throw new HttpFailure(409, 'BACKUP_TARGET_MISMATCH');
					}
				},
			},
			{
				method: 'post',
				path: '/restore',
				input: BackupRestoreSchema,
				output: BackupStatusSchema,
				status: 202,

				handler: async ({ file, password, token }: z.infer<typeof BackupRestoreSchema>, signal) => {
					if (pending) throw new HttpFailure(409, 'BACKUP_BUSY');
					const plan = preview;
					if (
						!plan ||
						plan.token !== token ||
						plan.digest !== digest(file.payload) ||
						plan.expires < Date.now()
					)
						throw new HttpFailure(409, 'BACKUP_PREVIEW_EXPIRED');
					const archive = await decode(file, password, signal);
					if (pending || preview !== plan) throw new HttpFailure(409, 'BACKUP_BUSY');
					signal.throwIfAborted();
					preview = undefined;
					const job = { id: randomUUID(), state: 'restoring' as const };
					status = job;
					const owners = ownersOf(archive.entries).filter(
						({ pluginId }) => !this.#data.isHostOwner(pluginId),
					);
					pending = Promise.resolve()
						.then(() =>
							this.#marketplace.restoreBackup(
								owners,
								archive.packages ?? [],
								plan.marketplace,
								(signal) => this.#data.restore(archive, { signal, onDispose: context.onDispose }),
								context.signal,
							),
						)
						.then(
							() => {
								status = { ...job, state: 'succeeded' };
							},
							(cause) => {
								const error = restoreIssue(cause);
								report(error ?? 'BACKUP_RESTORE_FAILED');
								status = { ...job, state: 'failed', error };
							},
						)
						.finally(() => {
							pending = undefined;
							if (!context.signal.aborted) publisher.publish({ job: status });
						});
					publisher.publish({ job });
					return job;
				},
			},
			{
				method: 'get',
				path: '/status',
				input: empty,
				output: BackupJobSchema,

				handler: () => ({ job: status }),
			},
		] as const);
		context.self.readiness.set({ state: 'ready' });
	}
}
