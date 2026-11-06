import * as z from 'zod/mini';
import { hostDiagnosticSchema } from './model.js';
import { HOST_DIAGNOSTIC_ERROR_CODES } from './values.js';

export const HOST_DIAGNOSTIC_PATH = '/api/v1/system/diagnostics';

export const hostDiagnosticResponseSchema = z.strictObject({ diagnostics: hostDiagnosticSchema });

export type HostDiagnosticResponse = z.infer<typeof hostDiagnosticResponseSchema>;

export const hostDiagnosticErrorSchema = z.strictObject({ code: z.enum(HOST_DIAGNOSTIC_ERROR_CODES) });

/** Route schema is generated from the same strict protocol used by both peers.
 * Cross-field refinements remain enforced by the shared decoder before delivery.
 */
export function hostDiagnosticRouteSchema() {
	const error = z.toJSONSchema(hostDiagnosticErrorSchema, { target: 'draft-7' });
	return {
		response: {
			200: z.toJSONSchema(hostDiagnosticResponseSchema, { target: 'draft-7' }),
			400: error,
			401: error,
			403: error,
			503: error,
		},
	};
}
