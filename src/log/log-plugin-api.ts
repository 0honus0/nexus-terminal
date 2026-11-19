import { z } from 'zod';
import type { LogFields } from './log-record.js';

export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export type LogLevel = z.infer<typeof LogLevelSchema>;

/** 只接收有限的平面参数，不接收 Error、请求、配置或任意嵌套对象。 */
export const LogParamsSchema = z
	.record(z.string().min(1).max(80), z.union([z.string().max(2048), z.number().finite(), z.boolean()]))
	.refine((params) => Object.keys(params).length <= 32);

export type LogParams = z.infer<typeof LogParamsSchema>;

/** 插件只描述事件；来源、插件身份、记录 ID 和时间由宿主生成。 */
export const PluginLogInputSchema = z.strictObject({
	level: LogLevelSchema,
	code: z
		.string()
		.min(1)
		.max(160)
		.regex(/^[a-zA-Z0-9_.:-]+$/),
	params: LogParamsSchema.optional(),
	correlationId: z.string().min(1).max(160).optional(),
});

export type PluginLogInput = z.infer<typeof PluginLogInputSchema>;

/** ctx.app.log 仅提供本端记录，不提供通知、订阅、传输或历史读取。
 * 无效事件或卸载后的调用直接忽略，日志故障不影响插件业务，不返回失败结果。
 */
export interface PluginLogApi {
	report(event: PluginLogInput): void;
}

interface LogTarget {
	report(event: LogFields): void;
}

/** 插件日志适配：固定来源和插件身份，卸载后忽略记录；不创建 Pino。 */
export class PluginLog implements PluginLogApi {
	readonly #log: LogTarget;
	readonly #pluginId: string;
	readonly #signal: AbortSignal;

	constructor(log: LogTarget, pluginId: string, signal: AbortSignal) {
		this.#log = log;
		this.#pluginId = pluginId;
		this.#signal = signal;
	}

	report(event: PluginLogInput): void {
		const scoped = this.#toHostEvent(event);
		if (scoped) this.#log.report(scoped);
	}

	#toHostEvent(event: PluginLogInput): LogFields | undefined {
		// 先检查作用域，避免读取已卸载插件提供的 getter。
		if (this.#signal.aborted) return;
		try {
			const parsed = PluginLogInputSchema.safeParse(event);
			// 校验可能执行外部 getter，结束后复核作用域再绑定身份。
			if (!parsed.success || this.#signal.aborted) return;
			return { ...parsed.data, source: this.#pluginId, pluginId: this.#pluginId };
		} catch {
			// safeParse 可以遇到抛异常的 getter。直接丢弃这条插件输入。
			return undefined;
		}
	}
}
