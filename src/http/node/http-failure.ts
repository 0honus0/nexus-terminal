/** 已知 HTTP 失败。只有可公开的稳定标识和状态会进入响应。 */
export class HttpFailure extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
		if (!Number.isInteger(status) || status < 400 || status > 599 || !/^[A-Z][A-Z0-9_]*$/u.test(code)) {
			throw new TypeError('HTTP_FAILURE_INVALID');
		}
	}
}
