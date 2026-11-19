import { shallowRef } from 'vue';
import type { z } from 'zod';
import { HttpProblemSchema } from '../../http/http-problem-http-types.js';
import type { LogApi } from '../../log/browser/log-api.js';
import type { StateClient } from '../../state/browser/state-api.js';
import { CodedError } from '../../utils/error.js';
import { MarketplaceRepositorySchema } from '../marketplace-catalog-types.js';
import {
	MarketplaceCatalogListSchema,
	MarketplaceInstallAttemptsSchema,
	MarketplaceOperationListSchema,
	MarketplacePluginListSchema,
	MarketplaceRepositoryListSchema,
	MarketplaceRetainedDataListSchema,
	MarketplaceUninstallPlanSchema,
} from '../marketplace-http-types.js';
import {
	MarketplaceInstallPlanSchema,
	type MarketplaceInstallPlan,
	type MarketplaceRepositorySource,
} from '../marketplace-install-types.js';
import {
	MarketplaceOperationsSchema,
	MarketplaceOperationsTopic,
	MarketplaceOperationSchema,
	MarketplacePluginId,
	type MarketplaceOperation,
} from '../marketplace-types.js';

export { default as MarketplaceApp } from './MarketplaceApp.vue';

export { default as MarketplaceTile } from './MarketplaceTile.vue';

const base = `/api/plugins/${encodeURIComponent(MarketplacePluginId)}`;

type UninstallPlan = z.infer<typeof MarketplaceUninstallPlanSchema>;

type Submission =
	| { action: 'install'; plan: MarketplaceInstallPlan }
	| { action: 'reload'; pluginId: string }
	| { action: 'set-enabled'; pluginId: string; enabled: boolean }
	| { action: 'uninstall'; plan: UninstallPlan; data: 'keep' | 'clear' }
	| { action: 'clear-data'; pluginId: string };

async function request<Schema extends z.ZodType>(
	path: string,
	schema: Schema,
	signal: AbortSignal,
	method = 'GET',
	body?: object,
): Promise<z.output<Schema>> {
	const response = await fetch(base + path, {
		method,
		signal,
		...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
	});
	if (!response.ok) {
		const problem = HttpProblemSchema.safeParse(await response.json().catch(() => undefined));
		throw new CodedError(problem.success ? problem.data.code : 'MARKETPLACE_REQUEST_FAILED');
	}
	signal.throwIfAborted();
	return schema.parse(await response.json());
}

async function repositoryChange(path: string, method: string, signal: AbortSignal): Promise<void> {
	const response = await fetch(base + path, { method, signal });
	if (response.ok) {
		await response.body?.cancel();
		return;
	}
	const problem = HttpProblemSchema.safeParse(await response.json().catch(() => undefined));
	throw new CodedError(problem.success ? problem.data.code : 'MARKETPLACE_REQUEST_FAILED');
}

/** 视图读取可随窗口关闭。已提交的操作由宿主执行，登录会话负责接收最终状态。 */
export class MarketplaceDesktopApi {
	readonly #signal: AbortSignal;
	readonly #log: Pick<LogApi, 'report'>;
	readonly #owned = new Set<string>();
	readonly #operations = shallowRef<readonly MarketplaceOperation[]>([]);
	readonly operations = this.#operations;
	#publication = 0;

	constructor(signal: AbortSignal, log: Pick<LogApi, 'report'>) {
		this.#signal = signal;
		this.#log = log;
	}

	connect(state: Pick<StateClient, 'subscribe'>): () => void {
		return state.subscribe(MarketplaceOperationsTopic, MarketplaceOperationsSchema, {
			updated: (operations) => this.#accept(operations),

			unconfirmed: () => {
				if (!this.#signal.aborted) void this.readOperations().catch(() => undefined);
			},
		});
	}

	async readOperations(): Promise<readonly MarketplaceOperation[]> {
		const publication = this.#publication;
		const { items } = await request('/manager/operations', MarketplaceOperationListSchema, this.#signal);
		if (publication === this.#publication) this.#accept(items);
		return this.operations.value;
	}

	async readInstalled(signal: AbortSignal) {
		return (await request('/manager/plugins', MarketplacePluginListSchema, signal)).items;
	}

	async readCatalog(signal: AbortSignal) {
		return (await request('/plugins', MarketplaceCatalogListSchema, signal)).items;
	}

	async readRepositories(signal: AbortSignal) {
		return (await request('/repositories', MarketplaceRepositoryListSchema, signal)).items;
	}

	async readRetained(signal: AbortSignal) {
		return (await request('/manager/retained-data', MarketplaceRetainedDataListSchema, signal)).items;
	}

	async readAttempts(signal: AbortSignal) {
		return (await request('/manager/install-attempts', MarketplaceInstallAttemptsSchema, signal)).items;
	}

	dismissAttempt(pluginId: string): Promise<void> {
		return repositoryChange('/manager/install-attempts/' + encodeURIComponent(pluginId), 'DELETE', this.#signal);
	}

	previewInstall(source: MarketplaceRepositorySource, signal: AbortSignal): Promise<MarketplaceInstallPlan> {
		return request('/manager/install-plan', MarketplaceInstallPlanSchema, signal, 'POST', source);
	}

	previewUninstall(pluginId: string, signal: AbortSignal): Promise<UninstallPlan> {
		return request(
			`/manager/plugins/${encodeURIComponent(pluginId)}/uninstall-plan`,
			MarketplaceUninstallPlanSchema,
			signal,
		);
	}

	saveRepository(input: { id?: string; url: string; label?: string }) {
		const { id, url, label } = input;
		return id
			? request('/repositories/' + encodeURIComponent(id), MarketplaceRepositorySchema, this.#signal, 'PATCH', {
					url,
					label,
				})
			: request('/repositories', MarketplaceRepositorySchema, this.#signal, 'POST', { url });
	}

	refreshRepository(id: string, signal = this.#signal): Promise<void> {
		return repositoryChange('/repositories/' + encodeURIComponent(id) + '/refresh', 'POST', signal);
	}

	removeRepository(id: string): Promise<void> {
		return repositoryChange('/repositories/' + encodeURIComponent(id), 'DELETE', this.#signal);
	}

	async submit(command: Submission): Promise<MarketplaceOperation> {
		const observationId = crypto.randomUUID();
		this.#owned.add(observationId);
		try {
			const operation = await this.#send(command, observationId);
			const current = this.operations.value.find(({ id }) => id === operation.id);
			if (!current) this.#accept([...this.operations.value, operation]);
			return current ?? operation;
		} catch (cause) {
			if (!this.#signal.aborted) {
				// 响应丢失时查同一次受理记录，避免重复提交安装或清理。
				const accepted = (await this.readOperations().catch(() => [])).find(
					(item) => item.observationId === observationId,
				);
				if (accepted) return accepted;
			}
			this.#owned.delete(observationId);
			throw cause;
		}
	}

	#send(command: Submission, observationId: string) {
		switch (command.action) {
			case 'install':
				return request('/manager/install', MarketplaceOperationSchema, this.#signal, 'POST', {
					plan: command.plan,
					observationId,
				});
			case 'uninstall':
				return request('/manager/uninstall', MarketplaceOperationSchema, this.#signal, 'POST', {
					pluginId: command.plan.pluginId,
					revision: command.plan.revision,
					data: command.data,
					observationId,
				});
			case 'set-enabled':
				return request(
					'/manager/plugins/' + encodeURIComponent(command.pluginId),
					MarketplaceOperationSchema,
					this.#signal,
					'PATCH',
					{
						enabled: command.enabled,
						observationId,
					},
				);
			case 'reload':
				return request('/manager/reload', MarketplaceOperationSchema, this.#signal, 'POST', {
					pluginId: command.pluginId,
					observationId,
				});
			case 'clear-data':
				return request('/manager/clear-data', MarketplaceOperationSchema, this.#signal, 'POST', {
					pluginId: command.pluginId,
					observationId,
				});
		}
	}

	#accept(operations: readonly MarketplaceOperation[]): void {
		if (this.#signal.aborted) return;
		this.#publication++;
		this.#operations.value = operations;
		for (const { observationId, state, error, change } of operations) {
			if (!observationId || (state !== 'succeeded' && state !== 'failed') || !this.#owned.delete(observationId))
				continue;
			this.#log.report({
				source: 'marketplace',
				level: state === 'failed' ? 'error' : 'info',
				code: error ?? 'MARKETPLACE_OPERATION_SUCCEEDED',
				params: { pluginId: change.pluginId },
				userVisible: true,
			});
		}
	}
}
