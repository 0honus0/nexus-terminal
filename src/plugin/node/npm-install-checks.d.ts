/** 上游未发布 TypeScript 声明；仅补全本体使用的公开函数，不经 SDK 转出。 */
declare module 'npm-install-checks' {
	export function checkEngine(
		target: { engines?: { node?: string; npm?: string } },
		npmVersion: string | undefined,
		nodeVersion: string | undefined,
		force?: boolean,
	): void;

	export function checkPlatform(
		target: {
			os?: string | string[];
			cpu?: string | string[];
			libc?: string | string[];
		},
		force?: boolean,
		environment?: { os?: string; cpu?: string; libc?: string },
	): void;
}
