import pino, { type DestinationStream, type Level, type Logger, type LoggerOptions } from 'pino';

import type { LogWriterApi } from '../log-record.js';

export class LogWriter implements LogWriterApi {
	readonly #logger: Logger;

	/** 配置由启动装配提供并交给 Pino 检查；初始化失败原样上抛，不能静默启动。 */
	constructor(options: LoggerOptions = {}, destination?: DestinationStream) {
		this.#logger = pino(
			{
				base: undefined,
				level: 'info',
				...options,
				timestamp: false,
				// 使用 Pino 官方序列化器保留 Error.cause 链及堆栈。
				serializers: { err: pino.stdSerializers.errWithCause, ...options.serializers },
			},
			destination ?? pino.destination({ dest: 1, sync: true }),
		);
	}

	/** 仅供启动装配控制输出，不能影响本体会话历史。 */
	setLevel(level: Level): void {
		this.#logger.level = level;
	}

	write(level: Level, fields: Readonly<Record<string, unknown>>): void {
		// 直接委托 Pino，异常由 LogApi.report 统一隔离。
		this.#logger[level](fields);
	}
}
