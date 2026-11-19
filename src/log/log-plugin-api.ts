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
		const scoped = scopePluginLogInput(event, PluginLogInputSchema, this.#pluginId, this.#signal);
		if (scoped) this.#log.report(scoped);
	}
}

/** 前后端共用日志校验和来源绑定，浏览器可以声明额外的展示字段。 */
export function scopePluginLogInput<Input extends PluginLogInput>(
	event: unknown,
	schema: z.ZodType<Input>,
	pluginId: string,
	signal: AbortSignal,
): (Input & Pick<LogFields, 'source' | 'pluginId'>) | undefined {
	// 先检查作用域，避免读取已卸载插件提供的 getter。
	if (signal.aborted) return undefined;
	try {
		const parsed = schema.safeParse(event);
		if (!parsed.success || signal.aborted) return undefined;
		return { ...parsed.data, source: pluginId, pluginId };
	} catch {
		// 校验可能执行外部 getter。异常输入直接丢弃。
		return undefined;
	}
}
