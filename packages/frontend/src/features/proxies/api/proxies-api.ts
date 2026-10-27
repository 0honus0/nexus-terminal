import { readTargetDeleted, targetNumber } from '@nexus-terminal/shared/targets/http';
import type { TargetProxyInput } from '@nexus-terminal/shared/targets/proxies/http';
import {
	readProxyList,
	readProxyView,
	readProxyInput,
	readProxyUpdateRequest,
	readProxyMutation,
} from '@nexus-terminal/shared/targets/proxies/http-codec';
import { requestTarget } from '@/client/targets/target-request';
import { toProxySummary } from '../model/proxy-mapper';
import type { ProxySummary } from '../model/proxy-types';

export const proxiesApi = {
	async list(signal?: AbortSignal): Promise<ProxySummary[]> {
		return (
			await requestTarget({ method: 'GET', path: '/proxies', status: 200, decode: readProxyList, signal })
		).map(toProxySummary);
	},

	async create(input: TargetProxyInput, signal?: AbortSignal): Promise<ProxySummary> {
		const item = await requestTarget({
			method: 'POST',
			path: '/proxies',
			status: 201,
			decode: readProxyView,

			input: () =>
				readProxyInput({
					name: input.name,
					type: input.type,
					host: input.host,
					port: input.port,
					username: input.username,
					...(input.password === undefined ? {} : { password: input.password }),
				}),

			signal,
		});
		return toProxySummary(item);
	},

	async update(snapshot: ProxySummary, input: TargetProxyInput, signal?: AbortSignal): Promise<ProxySummary> {
		const id = snapshot.id;
		const version = snapshot.version;
		const item = await requestTarget({
			method: 'PUT',
			path: `/proxies/${id}`,
			status: 200,

			input: () => {
				targetNumber(id);
				return readProxyUpdateRequest({
					version,
					changes: {
						name: input.name,
						type: input.type,
						host: input.host,
						port: input.port,
						username: input.username,
						...(input.password === undefined ? {} : { password: input.password }),
					},
				});
			},

			decode: (value) => {
				const result = readProxyMutation(value);
				if (result.status !== 'updated' || result.value.id !== id || result.value.version !== version + 1) {
					throw new Error('Unrelated proxy mutation');
				}
				return result.value;
			},

			signal,
		});
		return toProxySummary(item);
	},

	async remove(id: number, signal?: AbortSignal): Promise<void> {
		await requestTarget({
			method: 'DELETE',
			path: `/proxies/${id}`,
			status: 200,

			input: () => {
				targetNumber(id);
				return undefined;
			},

			decode: readTargetDeleted,
			signal,
		});
	},
};
