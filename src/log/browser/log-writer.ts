import pino, { type Level, type Logger, type LoggerOptions } from 'pino';

import type { LogWriterApi } from '../log-record.js';

export class LogWriter implements LogWriterApi {
	readonly #logger: Logger;

	/** 构建工具解析到 Pino 官方 browser 入口；配置检查与初始化异常交给库，不在此捕获。 */
	constructor(options: LoggerOptions = {}) {
		this.#logger = pino({
			level: 'info',
			...options,
			timestamp: false,
			// 本模块只负责本地输出，覆盖传入的 transmit，防止绕过职责产生跨端传输。
			browser: { ...options.browser, asObject: true, transmit: undefined },
		});
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
