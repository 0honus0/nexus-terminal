import { CodedError } from '../utils/error.js';

/** 插件作用域的生命周期由运行时管理。 */
export interface PluginScopeApi {
	readonly signal: AbortSignal;

	/** 登记当前作用域的资源清理。返回值用于撤销有效作用域中的登记。失效后登记会直接安排清理。 */
	onDispose(cleanup: () => void | Promise<void>): () => void;
}

type Cleanup = Parameters<PluginScopeApi['onDispose']>[0];

/** 管理运行时、插件实例或依赖绑定的生命周期。宿主负责取消并等待已登记的清理。 */
export class PluginScope implements PluginScopeApi {
	readonly #controller = new AbortController();
	readonly #cleanups = new Set<Cleanup>();
	readonly #late = new Set<Promise<void>>();
	readonly #failures: unknown[] = [];
	readonly #report: (cause: unknown) => void;
	#closing: Promise<void> | undefined;
	#closed = false;

	constructor(report: (cause: unknown) => void) {
		this.#report = report;
	}

	get signal(): AbortSignal {
		return this.#controller.signal;
	}

	/** 执行作用域内的一段同步调用；浏览器在这里关联 Vue 副作用。 */
	run<Result>(operation: () => Result): Result {
		this.signal.throwIfAborted();
		return operation();
	}

	abort(): void {
		// 先通知使用方停止接收工作，已登记的资源由 close() 统一释放。
		this.#controller.abort(new CodedError('PLUGIN_CONTEXT_EXPIRED'));
	}

	onDispose(cleanup: Cleanup): () => void {
		const registered = () => cleanup();

		if (this.signal.aborted) {
			// 异步初始化可能在取消后才返回资源，迟到的清理直接排队执行。
			const pending = Promise.resolve().then(() => this.#dispose(registered));
			this.#late.add(pending);
			void pending.then(() => this.#late.delete(pending));
		} else {
			this.#cleanups.add(registered);
		}
		return () => this.#cleanups.delete(registered);
	}

	close(): Promise<void> {
		const closing = (this.#closing ??= Promise.resolve().then(() => this.#drain()));
		this.abort();
		return closing;
	}

	async #drain(): Promise<void> {
		// 后登记的资源可能依赖先登记的资源，关闭时按逆序释放。
		for (const cleanup of [...this.#cleanups].reverse()) {
			if (this.#cleanups.delete(cleanup)) await this.#dispose(cleanup);
		}
		while (this.#late.size) await Promise.all([...this.#late]);
		this.#closed = true;
		if (this.#failures.length > 0) throw new AggregateError(this.#failures, 'PLUGIN_CLEANUP_FAILED');
	}

	async #dispose(cleanup: Cleanup): Promise<void> {
		try {
			await cleanup();
		} catch (cause) {
			if (this.#closed) this.#report(cause);
			else this.#failures.push(cause);
		}
	}
}
