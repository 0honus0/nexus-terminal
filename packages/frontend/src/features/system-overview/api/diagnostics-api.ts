import {
	readHostDiagnosticResponse,
	readHostDiagnosticError,
} from '@nexus-terminal/shared/system/diagnostics/http-codec';
import { HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/system/diagnostics/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { HostDiagnosticFailure, type HostDiagnostics } from '../model/diagnostic-types';
import { fromDiagnostics } from '../model/diagnostic-mapper';

export async function getHostDiagnostics(signal?: AbortSignal): Promise<HostDiagnostics> {
	try {
		const response = await requestJson({
			url: '/api/v1/system/diagnostics',
			method: 'GET',
			maxRequestBytes: HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES,
			maxResponseBytes: HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES,
			signal,
		});
		if (response.status >= 400) {
			let code;
			try {
				code = readHostDiagnosticError(response.body).code;
				const status =
					code === 'invalid_input'
						? 400
						: code === 'unauthenticated'
							? 401
							: code === 'forbidden'
								? 403
								: 503;
				if (response.status !== status) {
					throw new Error('Inconsistent diagnostic status');
				}
			} catch (cause) {
				throw new HostDiagnosticFailure('protocol_failure', { cause });
			}
			throw new HostDiagnosticFailure(code);
		}
		if (response.status !== 200) {
			throw new HostDiagnosticFailure('protocol_failure');
		}
		const value = readHostDiagnosticResponse(response.body).diagnostics;
		if (!Number.isFinite(new Date(value.collectedAt).getTime())) {
			throw new HostDiagnosticFailure('protocol_failure');
		}
		return fromDiagnostics(value);
	} catch (cause) {
		if (cause instanceof HostDiagnosticFailure) {
			throw cause;
		}
		if (cause instanceof HttpRequestFailure) {
			throw new HostDiagnosticFailure(cause.code, { cause });
		}
		throw new HostDiagnosticFailure('protocol_failure', { cause });
	}
}
