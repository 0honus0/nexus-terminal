/** 通用带码错误；模块自行定义 code，cause 和 stack 仅用于内部诊断。 */
export class CodedError<Code extends string = string> extends Error {
	override readonly name = 'CodedError';

	constructor(
		readonly code: Code,
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}
