import { record, InvalidPayload } from '../../common/http-codec.js';
import { HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES } from './values.js';
import { hostDiagnosticResponseSchema, hostDiagnosticErrorSchema, type HostDiagnosticResponse } from './http.js';

export function readHostDiagnosticResponse(value: unknown): HostDiagnosticResponse {
	record(value, ['diagnostics'], HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES);
	const result = hostDiagnosticResponseSchema.safeParse(value);
	if (!result.success) {
		throw new InvalidPayload();
	}
	return result.data;
}

export function readHostDiagnosticError(value: unknown) {
	record(value, ['code']);
	const result = hostDiagnosticErrorSchema.safeParse(value);
	if (!result.success) {
		throw new InvalidPayload();
	}
	return result.data;
}
