import type { ClientRequest, IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type ProxyOptions } from 'vite';

export function backendProxy(target: string, externalOrigin?: string): ProxyOptions {
	const backend = new URL(target);
	const external = externalOrigin === undefined ? undefined : new URL(externalOrigin);

	function forwardOrigin(outgoing: ClientRequest, request: IncomingMessage): void {
		const { host, origin } = request.headers;
		if (origin === undefined) return;
		const protocol = request.socket instanceof TLSSocket ? 'https' : 'http';
		// 后端验证转发后的 Host。仅同源来路转换为其监听地址，跨站来路继续由后端拒绝。
		const direct = host && origin === `${protocol}://${host}`;
		const forwarded = external && host === external.host && origin === external.origin;
		outgoing.setHeader('Origin', direct || forwarded ? backend.origin : 'null');
	}

	return {
		target,
		changeOrigin: true,
		ws: true,

		configure(proxy) {
			proxy.on('proxyReq', forwardOrigin);
			proxy.on('proxyReqWs', forwardOrigin);
		},
	};
}

const externalOrigin = process.env.DEV_EXTERNAL_ORIGIN;
const allowedHosts = externalOrigin === undefined ? [] : [new URL(externalOrigin).hostname];
const proxy = { '/api': backendProxy(process.env.BACKEND_URL ?? 'http://127.0.0.1:9999', externalOrigin) };

export default defineConfig({
	root: fileURLToPath(new URL('./src/app/browser', import.meta.url)),
	publicDir: false,
	plugins: [
		vue(),
		{
			name: 'nexus:watch-source',

			configureServer({ watcher }) {
				// Vue 的仅类型依赖可能在 Vite 根目录之外，源码变化也要让组件重新编译。
				watcher.add(fileURLToPath(new URL('./src', import.meta.url)));
			},
		},
	],
	resolve: {
		dedupe: ['vue'],
	},
	server: { port: 9998, strictPort: true, allowedHosts, proxy },
	preview: { allowedHosts, proxy },
	build: {
		outDir: fileURLToPath(new URL('./dist/frontend', import.meta.url)),
		emptyOutDir: true,
		target: 'es2022',
	},
});
