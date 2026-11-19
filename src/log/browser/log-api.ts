import { v4 as randomUUID } from 'uuid';
import { readonly, shallowReadonly, shallowRef } from 'vue';
import type { DeepReadonly, Ref } from 'vue';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { PluginLog, type PluginLogApi } from '../log-plugin-api.js';
import { reportLog, type LogFields, type LogWriterApi } from '../log-record.js';

export { LogWriter } from './log-writer.js';

export { default as LogNotices } from './LogNotices.vue';

export { logViewerMessages } from './log-messages.js';

/** 浏览器宿主提交的本地日志事件。 */
export interface LogInput extends LogFields {
	userVisible?: boolean;
}

/** 浏览器日志历史中的记录，由本端生成 ID 和毫秒时间。 */
export interface LogRecord extends LogFields {
	id: string;
	time: number;
}

/** 仅交给本体日志管理应用；清空不生成日志，不影响输出或其他浏览器。 */
export interface LogHistoryApi {
	readonly entries: DeepReadonly<Ref<readonly LogRecord[]>>;
	readonly limit: number;

	clear(): void;
}

/** 信任已校验的调用契约；先保存脱敏快照，再尝试本端输出。 */
export class LogApi {
	readonly #writer: LogWriterApi;
	readonly #history = new LogHistory();
	readonly #notices = shallowRef<readonly Readonly<LogRecord>[]>([]);
	readonly notices = shallowReadonly(this.#notices);

	constructor(writer: LogWriterApi) {
		this.#writer = writer;
	}

	bind(pluginId: string, scope: PluginScopeApi): PluginLogApi {
		return new PluginLog(this, pluginId, scope.signal);
	}

	/** 仅用于本体装配，不通过 PluginLogApi 交付给插件。 */
	get history(): LogHistoryApi {
		return this.#history;
	}

	dismissNotice(id: string): void {
		this.#notices.value = this.#notices.value.filter((notice) => notice.id !== id);
	}

	/** 日志上报边界：输出失败不影响原业务，不返回 Result，不重试或递归记录。 */
	report(event: LogInput): void {
		reportLog(event, randomUUID, (record) => {
			// 先保存历史，输出过滤或异常时依然能在日志管理应用里查看。
			this.#history.append(record);
			if (event.userVisible) this.#notices.value = [...this.#notices.value.slice(-3), record];
			const { level, ...fields } = record;
			this.#writer.write(level, fields);
		});
	}
}

/** 最近 500 条本实例会话记录；刷新清空，不持久化、不补交、不存译文。 */
class LogHistory implements LogHistoryApi {
	readonly limit = 500;

	readonly #entries = shallowRef<readonly LogRecord[]>([]);
	readonly entries: DeepReadonly<Ref<readonly LogRecord[]>> = readonly(this.#entries);

	/** 接收脱敏且冻结的本体快照；不向输出方交付内部数组。 */
	append(record: LogRecord): void {
		this.#entries.value = Object.freeze([...this.#entries.value.slice(-(this.limit - 1)), record]);
	}

	clear(): void {
		this.#entries.value = [];
	}
}
