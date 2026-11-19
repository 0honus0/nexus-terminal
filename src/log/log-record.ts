import type { Level } from 'pino';
import type { LogParams } from './log-plugin-api.js';

/** 两端输出都会使用的事件字段。 */
export interface LogFields {
	level: Level;
	code: string;
	source: string;
	pluginId?: string;
	params?: LogParams;
	correlationId?: string;
}

/** 本地输出适配，由宿主注入，执行异常交给 report 隔离。 */
export interface LogWriterApi {
	write(level: Level, fields: Readonly<Record<string, unknown>>): void;
}

/** 将已在调用边界校验的事件转为本体记录；不重复解析 Schema 或检查生成结果。 */
function toLogRecord(event: LogFields, id: string) {
	const { source, pluginId, level, code, params, correlationId } = event;
	// 显式选取记录字段：不接受传入的 ID、时间、原始异常或其他额外属性进入浏览器历史。
	// 脱敏并冻结独立快照，避免调用方后续修改参数，也避免输出方修改历史中的参数。
	return Object.freeze({
		id,
		time: Date.now(),
		source,
		level,
		code,
		...(pluginId !== undefined ? { pluginId } : {}),
		...(correlationId !== undefined ? { correlationId } : {}),
		...(params !== undefined ? { params: Object.freeze(redactParams(params)) } : {}),
	});
}

/** 共用记录生成与故障隔离。输出异常不影响业务，也不触发重试或新的日志。 */
export function reportLog(
	event: LogFields,
	createId: () => string,
	write: (record: ReturnType<typeof toLogRecord>) => void,
): void {
	try {
		write(toLogRecord(event, createId()));
	} catch {
		// 日志常在业务 catch 中调用，记录生成或输出失败不能覆盖原始异常。
	}
}

/** 平面字段的显式脱敏策略；调用方仍必须避免在 code、关联 ID 或普通参数中放入秘密。 */
const sensitiveKeys = new Set([
	'password',
	'currentpassword',
	'newpassword',
	'passphrase',
	'token',
	'accesstoken',
	'refreshtoken',
	'idtoken',
	'secret',
	'clientsecret',
	'authorization',
	'cookie',
	'setcookie',
	'privatekey',
]);

export function redactParams(params: LogParams): LogParams {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [
			key,
			sensitiveKeys.has(key.replace(/[-_]/g, '').toLowerCase()) ? '[Redacted]' : value,
		]),
	);
}
