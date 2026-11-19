import { randomUUID } from 'node:crypto';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { PluginLog, type PluginLogApi } from '../log-plugin-api.js';
import { reportLog, type LogFields, type LogWriterApi } from '../log-record.js';

export { LogWriter } from './log-writer.js';

/** 原始原因仅供 Node 本地输出，调用方应避免附加密码、密钥或完整请求。 */
export interface LogInput extends LogFields {
	cause?: unknown;
}

/** 本体事件经脱敏并生成记录，再交给注入的本端输出；信任已校验的调用契约。 */
export class LogApi {
	readonly #writer: LogWriterApi;

	constructor(writer: LogWriterApi) {
		this.#writer = writer;
	}

	bind(pluginId: string, scope: PluginScopeApi): PluginLogApi {
		return new PluginLog(this, pluginId, scope.signal);
	}

	/** 日志上报边界：输出失败不影响原业务，不返回 Result，不重试或递归记录。 */
	report(event: LogInput): void {
		reportLog(event, randomUUID, (record) => {
			const { level, ...fields } = record;
			// cause 即使是 undefined 也可能来自 throw，按字段是否存在区分普通事件。
			if ('cause' in event) {
				const cause = event.cause;
				const err = cause instanceof Error ? cause : new Error('NON_ERROR_THROWN', { cause });
				this.#writer.write(level, { ...fields, err });
			} else {
				this.#writer.write(level, fields);
			}
		});
	}
}
