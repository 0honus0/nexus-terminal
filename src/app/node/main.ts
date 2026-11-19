import { once } from 'node:events';
import { z } from 'zod';
import { CodedError } from '../../utils/error.js';
import { App } from './app.js';

const PluginDirectoriesSchema = z.array(z.string().min(1));
const PortSchema = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().min(0).max(65535));

function readDevelopmentDirectories(): readonly string[] {
	const { PLUGIN_DIRECTORIES: directories } = process.env;
	if (directories === undefined) return [];
	try {
		return PluginDirectoriesSchema.parse(JSON.parse(directories));
	} catch (cause) {
		throw new CodedError('PLUGIN_DIRECTORIES_INVALID', { cause });
	}
}

function listenForShutdown(app: App) {
	const shutdown = new AbortController();
	const { signal } = shutdown;

	function requestShutdown(): void {
		if (signal.aborted) return;
		shutdown.abort();
		// 立即取消仍在进行的启动。main() 会等待同一次关闭并传播失败。
		void app.close(signal.reason).catch(() => undefined);
	}

	const requested = once(signal, 'abort');
	process.on('SIGINT', requestShutdown);
	process.on('SIGTERM', requestShutdown);
	return {
		signal,
		requested,

		[Symbol.dispose]() {
			process.off('SIGINT', requestShutdown);
			process.off('SIGTERM', requestShutdown);
		},
	};
}

async function startApp(app: App, developmentDirectories: readonly string[], signal: AbortSignal): Promise<void> {
	try {
		await app.initialize();
		signal.throwIfAborted();
		await app.startBuiltinPlugins();
		signal.throwIfAborted();
		await app.startExternalPlugins(developmentDirectories);
	} catch (cause) {
		// 仅将本次信号触发的取消视为正常退出，其他启动错误继续上抛。
		if (!signal.aborted || cause !== signal.reason) throw cause;
	}
}

async function main(): Promise<void> {
	const port = PortSchema.safeParse(process.env.PORT ?? '9999');
	if (!port.success) throw new CodedError('HTTP_PORT_INVALID');

	const developmentDirectories = readDevelopmentDirectories();
	const app = new App({
		dataDirectory: process.env.DATA_DIRECTORY ?? '.data',
		httpPort: port.data,
	});
	using shutdown = listenForShutdown(app);
	try {
		await startApp(app, developmentDirectories, shutdown.signal);
		await shutdown.requested;
	} finally {
		await app.close();
	}
}

await main();
