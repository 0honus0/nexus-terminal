import type { z } from 'zod';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import { HttpProblemSchema } from '../http-problem-http-types.js';

/** 解析相对于插件路由根的地址，保留请求查询参数。 */
export function pluginEndpoint(ownerId: string, path: string): URL {
	const prefix = '/api/plugins/' + encodeURIComponent(ownerId);
	const url = new URL(prefix + '/' + path.replace(/^\//u, ''), location.origin);
	if (url.origin !== location.origin || !url.pathname.startsWith(prefix + '/') || url.hash)
		throw new CodedError('PLUGIN_ENDPOINT_INVALID');
	return url;
}

/** 服务器返回的 HTTP 失败。请求取消和网络失败保留 Fetch 的异常语义。 */
export class PluginHttpError extends Error {
	override readonly name = 'PluginHttpError';

	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

export interface PluginHttpClientApi {
	url(path: string): string;
	request(path: string, options?: RequestInit): Promise<Response>;
	json<Schema extends z.ZodType>(path: string, schema: Schema, options?: RequestInit): Promise<z.output<Schema>>;
}

export class HttpClientService {
	bind(ownerId: string, { signal }: PluginScopeApi): PluginHttpClientApi {
		const url = (path: string) => pluginEndpoint(ownerId, path).href;

		async function request(path: string, options?: RequestInit): Promise<Response> {
			const active = options?.signal ? AbortSignal.any([signal, options.signal]) : signal;
			active.throwIfAborted();
			const response = await fetch(url(path), {
				...options,
				credentials: 'same-origin',
				redirect: 'error',
				signal: active,
			});
			if (active.aborted) {
				// A response that arrives after cancellation must not retain an unread body.
				void response.body?.cancel().catch(() => undefined);
				active.throwIfAborted();
			}
			return response;
		}

		return Object.freeze<PluginHttpClientApi>({
			url,
			request,

			async json(path, schema, options) {
				const response = await request(path, options);
				if (!response.ok) {
					const problem = HttpProblemSchema.safeParse(await response.json().catch(() => undefined));
					signal.throwIfAborted();
					options?.signal?.throwIfAborted();
					throw new PluginHttpError(response.status, problem.data?.code ?? 'PLUGIN_HTTP_REQUEST_FAILED');
				}
				const body: unknown = response.status === 204 ? undefined : await response.json();
				signal.throwIfAborted();
				options?.signal?.throwIfAborted();
				return schema.parse(body);
			},
		});
	}
}
