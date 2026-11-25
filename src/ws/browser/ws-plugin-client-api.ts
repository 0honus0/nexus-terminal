import { useWebSocket, type UseWebSocketOptions, type UseWebSocketReturn } from '@vueuse/core';
import { pluginEndpoint } from '../../http/browser/http-plugin-client-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';

export type PluginWsClientOptions = Pick<
	UseWebSocketOptions,
	'protocols' | 'autoReconnect' | 'onConnected' | 'onDisconnected' | 'onError' | 'onMessage'
> & {
	readonly signal?: AbortSignal;
	readonly binaryType?: BinaryType;
};

type Message = string | ArrayBuffer | Blob;

export interface PluginWsClientApi {
	url(path: string): string;
	/** 自动重连可选。断线期间发送直接返回 false。 */
	connect(
		path: string,
		options?: PluginWsClientOptions,
	): Pick<UseWebSocketReturn<Message>, 'data' | 'status' | 'send' | 'close'>;
}

export class WsClientService {
	bind(ownerId: string, scope: PluginScopeApi): PluginWsClientApi {
		const url = (path: string) => {
			const address = pluginEndpoint(ownerId, path);
			address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
			return address.href;
		};

		return Object.freeze<PluginWsClientApi>({
			url,

			connect(path, { signal, binaryType = 'arraybuffer', ...options } = {}) {
				const active = signal ? AbortSignal.any([signal, scope.signal]) : scope.signal;
				active.throwIfAborted();
				let closed = false;
				const socket = useWebSocket<Message>(url(path), {
					...options,
					autoClose: false,
					autoConnect: false,
					immediate: false,

					onConnected(ws) {
						if (closed || active.aborted || socket.ws.value !== ws) return;
						ws.binaryType = binaryType;
						options.onConnected?.(ws);
					},

					onDisconnected(ws, event) {
						if (!closed && !active.aborted && socket.ws.value === ws) options.onDisconnected?.(ws, event);
					},

					onMessage(ws, event) {
						if (!closed && !active.aborted && socket.ws.value === ws) options.onMessage?.(ws, event);
					},

					onError(ws, event) {
						if (!closed && !active.aborted && socket.ws.value === ws) options.onError?.(ws, event);
					},
				});

				function close(code?: number, reason?: string): void {
					if (closed) return;
					closed = true;
					active.removeEventListener('abort', abort);
					release();
					socket.close(code, reason);
				}

				function abort(): void {
					close();
				}

				const release = scope.onDispose(abort);
				active.addEventListener('abort', abort, { once: true });
				try {
					active.throwIfAborted();
					socket.open();
					if (socket.ws.value) socket.ws.value.binaryType = binaryType;
				} catch (cause) {
					close();
					throw cause;
				}

				return Object.freeze({
					data: socket.data,
					status: socket.status,
					close,

					send: (data) => !closed && !active.aborted && socket.send(data, false),
				});
			},
		});
	}
}
