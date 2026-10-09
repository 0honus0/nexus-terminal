import type { JsonValue } from '../../agent.types';
import type { ShellCapabilityService, UnifiedShellCommand } from '../../capabilities/shell-capability.service';
import type {
	AgentTool,
	ToolContext,
	ToolInspection,
	ToolPrecondition,
	ToolResult,
} from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

import type { SshJobView } from '../../capabilities/ssh-session.port';
import { sshSessionContext } from './ssh-session-input';

const sshJobResult = (job: SshJobView, maxOutputBytes: number): ToolResult => {
	const budget = Math.max(1, Math.min(64 * 1024, Math.floor(maxOutputBytes / 4)));
	const stdout = utf8Tail(job.result.stdout, budget);
	const stderr = utf8Tail(job.result.stderr, budget);
	return {
		ok: job.status === 'running' || job.status === 'succeeded',
		summary: `SSH job ${job.status}.`,
		userSummary: {
			key: 'agent.conversation.toolSummary.jobState',
			params: { stateKey: `agent.conversation.toolSummary.labels.jobState.${job.status}` },
		},
		data: {
			jobId: job.jobId,
			sessionId: job.sessionId,
			connectionId: job.connectionId,
			status: job.status,
			...job.result,
			stdout: stdout.text,
			stderr: stderr.text,
		},
		artifactRefs: [],
		truncated: job.result.truncated || stdout.truncated || stderr.truncated,
		// The queried record is confirmed, even when the remote command outcome is unknown.
		outcome: 'confirmed',
		...(job.status === 'unknown' ? { errorCode: 'SSH_JOB_OUTCOME_UNKNOWN' } : {}),
		semantic: { kind: 'execution', target: { target: 'ssh', id: String(job.connectionId) }, status: job.status },
		verification: {
			status:
				job.status === 'succeeded'
					? 'verified'
					: job.status === 'failed' || job.status === 'cancelled'
						? 'failed'
						: 'unverified',
			summary:
				job.status === 'succeeded'
					? 'SSH confirmed a zero exit code.'
					: 'Submission or channel closure alone does not prove successful execution.',
			evidenceRefs: [],
		},
	};
};

const MAX_ID_BYTES = 128;
const MAX_ARGV_ITEMS = 128;
const MAX_ARG_BYTES = 8 * 1024;
const MAX_TOTAL_ARG_BYTES = 64 * 1024;
const MAX_SHELL_BYTES = 32 * 1024;
const MAX_CWD_BYTES = 4096;

function invalidArgument(code: string, detail: string): never {
	throw new Error(code, { cause: new Error(`${detail} No command was executed.`) });
}

const record = (value: JsonValue): Record<string, JsonValue> => {
	if (!value || Array.isArray(value) || typeof value !== 'object')
		invalidArgument('SHELL_OBJECT_REQUIRED', 'Tool arguments and command must be JSON objects.');
	return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
	const keys = new Set(allowed);
	if (Object.keys(value).some((key) => !keys.has(key)))
		invalidArgument('SHELL_UNKNOWN_FIELD', `Only these fields are accepted here: ${allowed.join(', ')}.`);
};

const stringValue = (value: JsonValue | undefined, maxBytes: number, field = 'string field'): string => {
	if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
		invalidArgument(
			'SHELL_STRING_INVALID',
			`${field} must be a non-empty string without NUL, at most ${maxBytes} UTF-8 bytes.`,
		);
	}
	return value;
};

const targetKind = (value: JsonValue | undefined): 'ssh' => {
	if (value !== 'ssh') invalidArgument('SHELL_TARGET_INVALID', 'target must be ssh.');
	return value;
};

const selectorFrom = (args: Record<string, JsonValue>) => ({
	target: targetKind(args.target),
	id: stringValue(args.id, MAX_ID_BYTES, 'id'),
});

const positiveInteger = (value: JsonValue | undefined, fallback?: number): number => {
	if (value === undefined && fallback !== undefined) return fallback;
	if (!Number.isSafeInteger(value) || Number(value) < 1)
		invalidArgument(
			'SHELL_POSITIVE_INTEGER_REQUIRED',
			'timeoutSeconds/waitSeconds must be a positive safe integer in seconds.',
		);
	return Number(value);
};

const argvValue = (value: JsonValue | undefined): string[] => {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARGV_ITEMS) {
		invalidArgument('SHELL_ARGV_COUNT_INVALID', `command.argv must contain 1 to ${MAX_ARGV_ITEMS} strings.`);
	}
	let total = 0;
	const argv = value.map((item) => {
		if (typeof item !== 'string' || item.includes('\0'))
			invalidArgument('SHELL_ARGV_ITEM_INVALID', 'Each command.argv item must be a string without NUL.');
		const bytes = Buffer.byteLength(item, 'utf8');
		if (bytes > MAX_ARG_BYTES)
			invalidArgument(
				'SHELL_ARGV_ITEM_TOO_LARGE',
				`Each command.argv item must be at most ${MAX_ARG_BYTES} UTF-8 bytes.`,
			);
		total += bytes;
		return item;
	});
	if (total > MAX_TOTAL_ARG_BYTES)
		invalidArgument(
			'SHELL_ARGV_TOO_LARGE',
			`Combined command.argv must be at most ${MAX_TOTAL_ARG_BYTES} UTF-8 bytes.`,
		);
	if (!argv[0])
		invalidArgument('SHELL_EXECUTABLE_EMPTY', 'command.argv[0] must be a non-empty executable name or path.');
	return argv;
};

const commandValue = (value: JsonValue | undefined): UnifiedShellCommand => {
	const command = record(value as JsonValue);
	onlyKeys(command, ['kind', 'argv', 'shellScript']);
	if (command.kind === 'argv') {
		if (command.shellScript !== undefined)
			invalidArgument(
				'SHELL_COMMAND_FIELDS_CONFLICT',
				'kind=argv accepts argv, not shellScript; select one command form.',
			);
		return { kind: 'argv', argv: argvValue(command.argv) };
	}
	if (command.kind === 'shell') {
		if (command.argv !== undefined)
			invalidArgument(
				'SHELL_COMMAND_FIELDS_CONFLICT',
				'kind=shell accepts shellScript, not argv; select one command form.',
			);
		return { kind: 'shell', shellScript: stringValue(command.shellScript, MAX_SHELL_BYTES, 'command.shellScript') };
	}
	return invalidArgument(
		'SHELL_COMMAND_KIND_INVALID',
		'command.kind must be argv or shell for the selected SSH target.',
	);
};

const shellRisk = (command: string): 'mutate' | 'destructive' | 'forbidden' => {
	if (
		/(^|[;&|]\s*)rm\s+-rf\s+\/(?:\s|$)/i.test(command) ||
		/\/var\/run\/docker\.sock/i.test(command) ||
		/(^|\s)(?:mkfs(?:\.[a-z0-9]+)?|wipefs)\s/i.test(command)
	) {
		return 'forbidden';
	}
	if (/(^|[;&|]\s*)(?:shutdown|reboot|poweroff)\b/i.test(command) || /\brm\s+-rf\b/i.test(command)) {
		return 'destructive';
	}
	return 'mutate';
};

const operation = (
	cryptoHash: CryptoHashPort,
	context: ToolContext,
	toolName: string,
	target: ToolInspection['target'],
	normalizedArguments: JsonValue,
	resourceKeys: string[],
	preconditions: ToolPrecondition[],
	policyRevision: number,
): string =>
	hashOperation(
		{
			schemaVersion: 2,
			scope: {
				userId: context.userId,
				appId: context.appId,
				runId: context.runId,
				agentRuntimeId: context.agentRuntimeId,
			},
			tool: { name: toolName, version: '1.0.0' },
			target: {
				kind: target.kind,
				...('target' in target ? { target: target.target, id: target.id } : {}),
				targetIdentity: target.targetIdentity,
				endpoint: target.endpoint,
				loginUser: target.loginUser,
				configurationHash: target.configurationHash,
				connectionId: target.connectionId ?? null,
			},
			arguments: normalizedArguments,
			resourceKeys: [...new Set(resourceKeys)].sort(),
			preconditions: [...preconditions]
				.sort((a, b) => `${a.kind}\0${a.key}`.localeCompare(`${b.kind}\0${b.key}`))
				.map((item) => ({ kind: item.kind, key: item.key, observedValue: item.observedValue })),
			policyRevision,
			inputRevision: context.inputRevision,
		},
		cryptoHash,
	);

const utf8Tail = (value: string, maxBytes: number): { text: string; truncated: boolean } => {
	const buffer = Buffer.from(value, 'utf8');
	if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
	let start = buffer.byteLength - maxBytes;
	while (start < buffer.byteLength && (buffer[start]! & 0xc0) === 0x80) start += 1;
	return { text: buffer.subarray(start).toString('utf8'), truncated: true };
};

const targetSchema: Record<string, JsonValue> = {
	target: { type: 'string', enum: ['ssh'] },
	id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
};

export const createShellExecuteTool = (shell: ShellCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
	descriptor: {
		name: 'shell_execute',
		version: '1.0.0',
		description:
			'Execute argv or shellScript on an authorized SSH connection with optional cwd. argv arguments are quoted individually for the remote shell; shellScript is executable source, not a title. Pass environment variables explicitly through env/argv or shellScript. Background requires an owned SSH sessionId and returns a durable jobId; use shell_job_control list/status/wait/cancel, not busy-polling or detached bypasses. timeoutSeconds is a bounded execution lifetime, not a startup/health-check timeout. Never claim indefinite uptime; verify Job status and endpoints before reporting active services.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				...targetSchema,
				command: {
					type: 'object',
					additionalProperties: false,
					properties: {
						kind: { type: 'string', enum: ['argv', 'shell'] },
						argv: { type: 'array', minItems: 1, maxItems: MAX_ARGV_ITEMS, items: { type: 'string' } },
						shellScript: {
							type: 'string',
							minLength: 1,
							maxLength: MAX_SHELL_BYTES,
							description:
								'Executable shell script, not a display title; SSH uses its remote command shell.',
						},
					},
					required: ['kind'],
				},
				cwd: { type: 'string', minLength: 1, maxLength: MAX_CWD_BYTES },
				timeoutSeconds: {
					type: 'integer',
					minimum: 1,
					maximum: 86400,
					description:
						'Hard SSH process execution lifetime, including background services. Foreground at most 300 seconds, background at most 86400 seconds. Not a startup or wait timeout; include verification and cleanup within the selected lifetime.',
				},
				sessionId: { type: 'string', minLength: 1, maxLength: 128 },
				mode: { type: 'string', enum: ['foreground', 'background'] },
			},
			required: ['target', 'id', 'command'],
		},
		riskClass: 'mutate',
		capability: 'shell.execute',
	},

	isAvailable: ({ connectionIds }) => connectionIds === undefined || connectionIds.length > 0,

	inspect: async (input, context, policyRevision) => {
		const args = record(input);
		onlyKeys(args, ['target', 'id', 'command', 'cwd', 'timeoutSeconds', 'mode', 'sessionId']);
		const sessionContext = sshSessionContext(args, context);
		const selector = selectorFrom(args);
		const command = commandValue(args.command);
		const resolved = await shell.resolve(context, selector);
		await shell.inspectSshSession(sessionContext, resolved);
		const rawMode = args.mode === undefined ? 'foreground' : stringValue(args.mode, 16, 'mode');
		if (rawMode !== 'foreground' && rawMode !== 'background')
			invalidArgument('SHELL_MODE_INVALID', 'mode must be foreground or background.');
		const timeoutSeconds = positiveInteger(
			args.timeoutSeconds,
			rawMode === 'background'
				? 3600
				: Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
		);
		const limit = rawMode === 'background' ? 86400 : 300;
		if (timeoutSeconds > limit)
			invalidArgument(
				'SHELL_TIMEOUT_EXCEEDED',
				`timeoutSeconds exceeds the SSH ${rawMode} limit of ${limit} seconds.`,
			);
		if (rawMode === 'background' && args.sessionId === undefined) throw new Error('SSH_SESSION_REQUIRED');
		const cwd = args.cwd === undefined ? undefined : stringValue(args.cwd, MAX_CWD_BYTES, 'cwd');
		const normalizedArguments: JsonValue = {
			target: resolved.selector.target,
			id: resolved.selector.id,
			command,
			timeoutSeconds,
			mode: rawMode,
			...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
			...(cwd === undefined ? {} : { cwd }),
		};
		const risk = command.kind === 'shell' ? shellRisk(command.shellScript) : 'mutate';
		return {
			toolName: 'shell_execute',
			toolVersion: '1.0.0',
			normalizedArguments,
			target: resolved.fingerprint,
			resourceKeys: resolved.resourceKeys,
			risk,
			mutation: risk !== 'forbidden',
			operationHash: operation(
				cryptoHash,
				context,
				'shell_execute',
				resolved.fingerprint,
				normalizedArguments,
				resolved.resourceKeys,
				resolved.preconditions,
				policyRevision,
			),
			operationHashVersion: 1,
			preconditions: resolved.preconditions,
			policyRevision,
			inputRevision: context.inputRevision,
		};
	},

	execute: async (inspection, context) => {
		const args = record(inspection.normalizedArguments);
		const command = commandValue(args.command);
		const mode = stringValue(args.mode, 16) as 'foreground' | 'background';
		const target = shell.bindInspectionTarget(inspection.target);
		const executed = await shell.execute(sshSessionContext(args, context), target, {
			command,
			...(args.cwd === undefined ? {} : { cwd: stringValue(args.cwd, MAX_CWD_BYTES) }),
			timeoutSeconds: positiveInteger(args.timeoutSeconds),
			mode,
			operationHash: inspection.operationHash,
		});
		if (executed.sshJob) {
			const result = sshJobResult(executed.sshJob, context.maxOutputBytes);
			if (mode === 'background') {
				const executionTimeoutSeconds = positiveInteger(args.timeoutSeconds);
				result.data = { ...record(result.data ?? {}), executionTimeoutSeconds } as JsonValue;
				if (executed.sshJob.status === 'running') {
					result.summary += ` Execution lifetime is ${executionTimeoutSeconds} seconds from process start; expiry terminates this Job. This is not a startup timeout. Verify Job status and endpoints before reporting uptime; do not claim indefinite availability.`;
				}
			}
			return result;
		}
		if (!executed.result) throw new Error('TOOL_STATE_CONFLICT');
		const ok = executed.result.exitCode === 0;
		return {
			ok,
			summary: ok
				? 'SSH shell command completed successfully.'
				: `SSH shell command exited with code ${executed.result.exitCode}.`,
			userSummary: ok
				? { key: 'agent.conversation.toolSummary.sshShellCompleted' }
				: {
						key: 'agent.conversation.toolSummary.sshShellExited',
						params: { code: executed.result.exitCode ?? 0 },
					},
			data: {
				exitCode: executed.result.exitCode,
				signal: executed.result.signal,
				stdout: executed.result.stdout,
				stderr: executed.result.stderr,
				target: { target: executed.target.target, id: executed.target.id },
			},
			artifactRefs: [],
			truncated: executed.result.truncated,
			outcome: 'confirmed',
			...(ok ? {} : { errorCode: 'SSH_SHELL_NONZERO_EXIT' }),
			semantic: {
				kind: 'execution',
				target: executed.target,
				status: ok ? 'succeeded' : 'failed',
			},
			verification: {
				status: ok ? 'verified' : 'failed',
				summary: ok
					? 'The SSH command channel returned a confirmed zero exit status.'
					: 'The SSH command channel returned a confirmed non-zero exit status.',
				evidenceRefs: [],
			},
		};
	},
});

export const createShellJobTool = (shell: ShellCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
	descriptor: {
		name: 'shell_job_control',
		version: '1.0.0',
		modelExposure: 'deferred',
		description:
			'SSH Job list/status/wait/cancel on the authorized Thread/connection; list omits jobId. Wait expiry leaves Jobs running, not failed. Prefer bounded wait; cancel only an authorized Job. SSH disconnect outcomes are unknown, never replayed.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				target: { type: 'string', enum: ['ssh'] },
				id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
				jobId: { type: 'string', minLength: 1, maxLength: 80 },
				action: { type: 'string', enum: ['list', 'status', 'wait', 'cancel'] },
				waitSeconds: { type: 'integer', minimum: 1, maximum: 300 },
			},
			required: ['target', 'id', 'action'],
		},
		riskClass: 'control',
		capability: 'shell.execute',
	},

	isAvailable: ({ connectionIds }) => connectionIds === undefined || connectionIds.length > 0,

	inspect: async (input, context, policyRevision) => {
		const args = record(input);
		onlyKeys(args, ['target', 'id', 'jobId', 'action', 'waitSeconds']);
		const selector = selectorFrom(args);
		const action = stringValue(args.action, 16);
		if (action !== 'list' && action !== 'status' && action !== 'wait' && action !== 'cancel')
			invalidArgument('SHELL_JOB_ACTION_INVALID', 'action must be list, status, wait or cancel.');
		if (action === 'list' && args.jobId !== undefined)
			invalidArgument('SHELL_JOB_LIST_FIELDS_CONFLICT', 'list returns authorized active SSH jobs; omit jobId.');
		const jobId = action === 'list' ? undefined : stringValue(args.jobId, 80);
		if (jobId !== undefined && !/^ssh-job-[a-f0-9-]{36}$/.test(jobId))
			invalidArgument(
				'SHELL_JOB_ID_INVALID',
				'jobId must be the exact SSH ssh-job-UUID returned by shell_execute.',
			);
		const waitSeconds =
			action === 'wait'
				? positiveInteger(
						args.waitSeconds,
						Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
					)
				: undefined;
		if (action !== 'wait' && args.waitSeconds !== undefined)
			invalidArgument('SHELL_JOB_WAIT_FIELDS_CONFLICT', 'waitSeconds is accepted only with action=wait.');
		const resolved = { target: await shell.resolve(context, selector) };
		if (action !== 'list') await shell.sshJob(context, selector, jobId!, 'status');
		const normalizedArguments: JsonValue = {
			target: selector.target,
			id: resolved.target.selector.id,
			...(jobId === undefined ? {} : { jobId }),
			action,
			...(waitSeconds === undefined ? {} : { waitSeconds }),
		};
		return {
			toolName: 'shell_job_control',
			toolVersion: '1.0.0',
			normalizedArguments,
			target: resolved.target.fingerprint,
			resourceKeys: resolved.target.resourceKeys,
			risk: 'control',
			mutation: false,
			operationHash: operation(
				cryptoHash,
				context,
				'shell_job_control',
				resolved.target.fingerprint,
				normalizedArguments,
				resolved.target.resourceKeys,
				resolved.target.preconditions,
				policyRevision,
			),
			operationHashVersion: 1,
			preconditions: resolved.target.preconditions,
			policyRevision,
			inputRevision: context.inputRevision,
		};
	},

	execute: async (inspection, context) => {
		const args = record(inspection.normalizedArguments);
		const target = shell.bindInspectionTarget(inspection.target);
		if (args.action === 'list') {
			const data = await shell.listActiveJobs(context, target);
			return {
				ok: true,
				summary:
					'Authorized active SSH jobs observed for this Thread/connection. This does not verify command success.',
				data: { ...data, jobs: data.jobs.map((job) => ({ ...job })) },
				artifactRefs: [],
				truncated: false,
				outcome: 'confirmed',
				verification: {
					status: 'unverified',
					summary: 'Active Jobs have not reached verified terminal results.',
					evidenceRefs: [],
				},
			};
		}
		const action = stringValue(args.action, 16) as 'status' | 'wait' | 'cancel';
		return sshJobResult(
			await shell.sshJob(
				context,
				{ target: 'ssh', id: target.selector.id },
				stringValue(args.jobId, 80),
				action,
				args.waitSeconds === undefined ? undefined : positiveInteger(args.waitSeconds),
				inspection.target.configurationHash,
			),
			context.maxOutputBytes,
		);
	},
});

export const createUnifiedShellTools = (shell: ShellCapabilityService, cryptoHash: CryptoHashPort): AgentTool[] => [
	createShellExecuteTool(shell, cryptoHash),
	createShellJobTool(shell, cryptoHash),
];
