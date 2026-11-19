import { effectScope } from 'vue';
import { PluginScope } from '../plugin-api.js';

/** Vue 的同步副作用随作用域取消；异步创建的资源仍可通过 onDispose 登记。 */
export class BrowserPluginScope extends PluginScope {
	readonly #effects = effectScope(true);

	override run<Result>(operation: () => Result): Result {
		return super.run(() => this.#effects.run(operation) as Result);
	}

	override abort(): void {
		if (this.signal.aborted) return;
		super.abort();
		try {
			this.#effects.stop();
		} catch (cause) {
			// 即使 Vue 的清理抛出异常，宿主仍会排空其他已登记的资源。
			this.onDispose(() => {
				throw cause;
			});
		}
	}
}
