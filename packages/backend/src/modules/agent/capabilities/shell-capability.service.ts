import type { SshShellExecutionResult, SshShellTargetPort } from './ssh-shell-target.port';
import type { AgentSshSessionPort, SshJobView } from './ssh-session.port';
import { bindSshInspectionTarget, resolveSshTarget, type ResolvedSshTarget } from './ssh-target-binding';
import type { SshTargetResolverPort } from './ssh-target-resolver.port';
import type { ToolTargetFingerprint } from './tool-target.types';
import type { ToolContext } from './tool.types';

export type UnifiedShellCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; shellScript: string };

export type UnifiedShellMode = 'foreground' | 'background';

export interface SshShellSelector {
	target: 'ssh';
	id: string;
}

// SSH exec transports shell source, not a native argv vector. Quote every argument
// independently so shell operators, substitutions and whitespace remain literal.
const quoteShellArgument = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export interface UnifiedShellExecutionRequest {
	command: UnifiedShellCommand;
	cwd?: string;
	timeoutSeconds: number;
	mode: UnifiedShellMode;
	operationHash: string;
}

export interface UnifiedShellExecutionView {
	target: SshShellSelector;
	status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
	sshJob?: SshJobView;
	result?: SshShellExecutionResult & { timedOut: boolean };
	error?: string | null;
}

export class ShellCapabilityService {
	constructor(
		private readonly targets: SshTargetResolverPort,
		private readonly sshShell: SshShellTargetPort,
		private readonly sshSessions?: AgentSshSessionPort,
	) {}

	resolve(context: ToolContext, selector: SshShellSelector): Promise<ResolvedSshTarget> {
		if (selector.target !== 'ssh') throw new Error('SHELL_TARGET_INVALID');
		return resolveSshTarget(this.targets, context, selector);
	}

	bindInspectionTarget(fingerprint: ToolTargetFingerprint): ResolvedSshTarget {
		return bindSshInspectionTarget(fingerprint);
	}

	async execute(
		context: ToolContext,
		target: ResolvedSshTarget,
		request: UnifiedShellExecutionRequest,
	): Promise<UnifiedShellExecutionView> {
		if (target.selector.target !== 'ssh') throw new Error('SHELL_TARGET_INVALID');
		const source =
			request.command.kind === 'shell'
				? request.command.shellScript
				: `exec ${request.command.argv.map(quoteShellArgument).join(' ')}`;
		const shellScript = request.cwd === undefined ? source : `cd ${quoteShellArgument(request.cwd)} &&\n${source}`;
		const connectionId = target.connectionId;
		if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
		if (request.mode === 'background') {
			if (!context.sshSessionId || !this.sshSessions) throw new Error('SSH_SESSION_REQUIRED');
			const sshJob = await this.sshSessions.startJob(
				context,
				connectionId,
				target.fingerprint.configurationHash,
				context.sshSessionId,
				shellScript,
				request.timeoutSeconds,
				request.operationHash,
			);
			return { target: { target: 'ssh', id: target.selector.id }, status: sshJob.status, sshJob };
		}
		const result = await this.sshShell.execute(
			context,
			connectionId,
			shellScript,
			request.timeoutSeconds,
			target.fingerprint.configurationHash,
		);
		return {
			target: { target: 'ssh', id: target.selector.id },
			status: result.exitCode === 0 ? 'succeeded' : 'failed',
			result: { ...result, timedOut: false },
			error: null,
		};
	}

	async listActiveJobs(
		context: ToolContext,
		target: ResolvedSshTarget,
	): Promise<{ activeCount: number; jobs: { jobId: string; status: SshJobView['status']; createdAt: number }[] }> {
		if (target.selector.target !== 'ssh' || !this.sshSessions || target.connectionId === undefined)
			throw new Error('SSH_SESSION_NOT_FOUND');
		const current = await this.resolve(context, { target: 'ssh', id: target.selector.id });
		if (current.fingerprint.configurationHash !== target.fingerprint.configurationHash)
			throw new Error('RESOURCE_CHANGED');
		const jobs = await this.sshSessions.listJobs(context, target.connectionId);
		return { activeCount: jobs.length, jobs };
	}

	async sshJob(
		context: ToolContext,
		selector: SshShellSelector,
		jobId: string,
		action: 'status' | 'wait' | 'cancel',
		waitSeconds?: number,
		expectedConfigurationHash?: string,
	): Promise<SshJobView> {
		if (selector.target !== 'ssh' || !this.sshSessions) throw new Error('TOOL_ARGUMENTS_INVALID');
		const target = await this.resolve(context, selector);
		if (
			expectedConfigurationHash !== undefined &&
			target.fingerprint.configurationHash !== expectedConfigurationHash
		)
			throw new Error('RESOURCE_CHANGED');
		return this.sshSessions.job(context, target.connectionId!, jobId, action, waitSeconds);
	}

	async inspectSshSession(context: ToolContext, target: ResolvedSshTarget): Promise<void> {
		if (!context.sshSessionId) return;
		if (!this.sshSessions || target.connectionId === undefined) throw new Error('SSH_SESSION_NOT_FOUND');
		const sessions = await this.sshSessions.list(context, target.connectionId, context.sshSessionId);
		if (sessions[0]?.status !== 'ready') throw new Error('SSH_SESSION_DISCONNECTED');
	}
}
