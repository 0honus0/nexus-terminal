import { record, integer, text, InvalidPayload } from '../../common/http-codec.js';
import { HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES, HOST_DIAGNOSTIC_ERROR_CODES } from './values.js';
import type { HostDiagnosticResponse } from './http.js';

export function readHostDiagnosticResponse(value: unknown): HostDiagnosticResponse {
	const r = record(record(value, ['diagnostics'], HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES).diagnostics, [
		'collectedAt',
		'process',
		'database',
	]);
	const p = record(r.process, ['uptimeSeconds', 'residentBytes', 'heapUsedBytes', 'runtimeVersion']);
	const db = record(r.database, ['available', 'schemaVersion']);
	if (typeof db.available !== 'boolean' || db.available !== (db.schemaVersion !== null)) {
		throw new InvalidPayload();
	}
	return {
		diagnostics: {
			collectedAt: integer(r.collectedAt),
			process: {
				uptimeSeconds: integer(p.uptimeSeconds),
				residentBytes: integer(p.residentBytes),
				heapUsedBytes: integer(p.heapUsedBytes),
				runtimeVersion: text(p.runtimeVersion, 64),
			},
			database: {
				available: db.available,
				schemaVersion: db.schemaVersion === null ? null : integer(db.schemaVersion),
			},
		},
	};
}

export function readHostDiagnosticError(value: unknown): { code: (typeof HOST_DIAGNOSTIC_ERROR_CODES)[number] } {
	const r = record(value, ['code']);
	const code = HOST_DIAGNOSTIC_ERROR_CODES.find((code) => code === r.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}
