const errorNames: Readonly<Record<string, string>> = {
	AI_TypeValidationError: 'PROVIDER_RESPONSE_INVALID',
	AI_JSONParseError: 'PROVIDER_RESPONSE_INVALID',
	AI_NoContentGeneratedError: 'PROVIDER_RESPONSE_EMPTY',
};
const transportCodes: ReadonlyArray<readonly [RegExp, string]> = [
	[/^(?:ENOTFOUND|EAI_AGAIN)$/, 'PROVIDER_DNS_FAILED'],
	[/^(?:CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/, 'PROVIDER_TLS_FAILED'],
	[/^(?:ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)$/, 'PROVIDER_NETWORK_TIMEOUT'],
	[/^(?:ECONNREFUSED|ECONNRESET|EPIPE|UND_ERR_SOCKET)$/, 'PROVIDER_NETWORK_FAILED'],
];

export const providerHttpError = (status: number, retryAfter?: string | null): Error => {
	const error = new Error(`PROVIDER_HTTP_${status || 'ERROR'}`) as Error & { retryAfterMs?: number };
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) error.retryAfterMs = Math.min(30_000, Math.ceil(seconds * 1000));
	}
	return error;
};

export const mapProviderError = (error: unknown, signal?: AbortSignal): Error => {
	if (signal?.aborted) return signal.reason instanceof Error ? signal.reason : new Error('ABORTED');
	const seen = new Set<unknown>();
	let current = error;
	for (let depth = 0; depth < 8 && current && typeof current === 'object' && !seen.has(current); depth++) {
		seen.add(current);
		const value = current as Record<string, unknown>;
		if (typeof value.statusCode === 'number' && value.statusCode >= 400 && value.statusCode <= 599) {
			const headers = value.responseHeaders as Record<string, string> | undefined;
			return providerHttpError(value.statusCode, headers?.['retry-after']);
		}
		if (typeof value.name === 'string' && errorNames[value.name]) return new Error(errorNames[value.name]);
		const transport =
			typeof value.code === 'string'
				? transportCodes.find(([pattern]) => pattern.test(value.code as string))?.[1]
				: undefined;
		if (transport) return new Error(transport);
		if (current instanceof Error && /^(?:PROVIDER_|MODEL_|ABORTED$)[A-Z0-9_]*$/.test(current.message))
			return current;
		current = value.cause ?? value.lastError;
	}
	return new Error('PROVIDER_REQUEST_FAILED');
};
