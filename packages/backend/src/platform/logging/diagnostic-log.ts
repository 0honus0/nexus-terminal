import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger, LogFact, LogSeverity } from './logger.js';

export type DiagnosticFacts = Readonly<Record<string, string | number | boolean | null>>;

const context = new AsyncLocalStorage<DiagnosticFacts>();
const safeErrorCodes = new Set([
	'ECONNRESET',
	'ECONNREFUSED',
	'ETIMEDOUT',
	'EPIPE',
	'ENOTFOUND',
	'EAI_AGAIN',
	'EACCES',
	'EPERM',
	'ENOENT',
	'ENOSPC',
	'EMFILE',
	'EADDRINUSE',
	'SQLITE_BUSY',
	'SQLITE_FULL',
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'version_conflict',
	'limit_exceeded',
	'operation_unknown',
	'storage_unavailable',
	'remote_unavailable',
	'cleanup_failed',
	'provider_unavailable',
	'host_key_untrusted',
	'host_key_changed',
	'internal_failure',
	'cancelled',
	'shutting_down',
	'stale_target',
	'not_started',
]);

/** Metadata is scoped to the real async task; no request, token or payload is retained. */
export function withDiagnosticContext<T>(facts: DiagnosticFacts, work: () => T): T {
	return context.run({ ...context.getStore(), ...facts }, work);
}

/** Restore only diagnostic metadata; never capture another owner's transaction or authorization scope. */
export function bindDiagnosticContext<Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
): (...args: Args) => Result {
	const captured = context.getStore() ?? {};
	return (...args) => context.run(captured, () => callback(...args));
}

const safeFailureKinds = new Set([
	'http',
	'dns',
	'tls',
	'network',
	'timeout',
	'response_invalid',
	'response_empty',
	'stream_truncated',
	'too_large',
	'cleanup_failed',
	'unavailable',
	'limit_exceeded',
	'closed',
	'worker_exit',
	'constraint',
	'busy',
	'sql',
	'transaction',
	'commit_unknown',
	'rollback_failed',
	'not_started',
	'failed',
	'unknown',
	'client-authentication',
	'client-timeout',
	'client-socket',
	'client-ssh',
]);

function failureFacts(error: unknown): LogFact[] {
	const facts: LogFact[] = [];
	const seen = new Set<unknown>();
	const pending = [error];
	let omittedBranches = 0;
	for (let index = 0; pending.length && index < 4; index++) {
		const current = pending.shift();
		if (!(current instanceof Error) || seen.has(current)) {
			continue;
		}
		seen.add(current);
		const prefix = index === 0 ? 'error' : 'cause' + index;
		const kind = current.constructor.name;
		facts.push({ name: prefix + 'Type', value: /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(kind) ? kind : 'Error' });
		if ('code' in current && typeof current.code === 'string' && safeErrorCodes.has(current.code)) {
			facts.push({ name: prefix + 'Code', value: current.code });
		}
		const classification =
			'kind' in current
				? current.kind
				: 'level' in current
					? current.level
					: 'outcome' in current
						? current.outcome
						: null;
		if (typeof classification === 'string' && safeFailureKinds.has(classification)) {
			facts.push({ name: prefix + 'Kind', value: classification });
		}
		if (
			'httpStatus' in current &&
			typeof current.httpStatus === 'number' &&
			Number.isInteger(current.httpStatus) &&
			current.httpStatus >= 100 &&
			current.httpStatus <= 599
		) {
			facts.push({ name: prefix + 'HttpStatus', value: current.httpStatus });
		}
		if (
			'sqliteCode' in current &&
			typeof current.sqliteCode === 'number' &&
			Number.isSafeInteger(current.sqliteCode)
		) {
			facts.push({ name: prefix + 'SqliteCode', value: current.sqliteCode });
		}
		// Inspect frame lines only: the stack header may contain credentials or supplier response bodies.
		const location = current.stack
			?.slice(0, 8192)
			.split('\n')
			.slice(1, 10)
			.filter((line) => /^\s+at /u.test(line))
			.join('\n')
			.match(/\/(?:src|dist)\/[A-Za-z0-9_./-]+:\d+:\d+/u)?.[0];
		if (location) {
			facts.push({ name: prefix + 'Location', value: location.slice(-240) });
		}
		if (current instanceof AggregateError) {
			facts.push({ name: prefix + 'Count', value: current.errors.length });
			omittedBranches += Math.max(0, current.errors.length - 3);
			pending.push(...current.errors.slice(0, 3));
		}
		if (current.cause !== undefined) {
			pending.push(current.cause);
		}
	}
	if (pending.length || omittedBranches) {
		facts.push({ name: 'errorBranchesOmitted', value: pending.length + omittedBranches });
	}
	if (!(error instanceof Error)) {
		facts.push({ name: 'errorType', value: 'NonError' });
	}
	return facts;
}

/** Diagnostic failure must never fail a request, skip cleanup or change a durable outcome. */
export function logDiagnostic(
	logger: Logger | undefined,
	severity: LogSeverity,
	code: string,
	facts: DiagnosticFacts = {},
	error?: unknown,
): void {
	if (!logger) {
		return;
	}
	try {
		if (!logger.isEnabled(severity)) {
			return;
		}
		const entries = Object.entries({ ...context.getStore(), ...facts }).map(([name, value]) => ({ name, value }));
		if (error !== undefined) {
			entries.push(...failureFacts(error));
		}
		if (entries.length > 32) {
			const omitted = entries.length - 31;
			entries.length = 31;
			entries.push({ name: 'factsOmitted', value: omitted });
		}
		logger.write(severity, code, entries);
	} catch {
		// No fallback console/raw exception: logging sinks may be unavailable or full.
	}
}
