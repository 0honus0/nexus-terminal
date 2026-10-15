import { MachineDispatchFailure } from '../../../../platform/ssh/ssh-port.js';
import type { RemoteMachineModel } from './machine-model.js';
import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';
import type { AcpPort } from '../../../../platform/acp/acp-port.js';
import type { CommandPort } from '../../../../platform/commands/command-port.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteHostKeyUntrustedError } from './machine-errors.js';
import type {
	MachineOperationScope,
	ExecuteAcpRequest,
	ExecuteAcpResult,
	MachineClientIdentity,
} from './operation-types.js';

export class MachineAcpModel {
	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly commands: CommandPort,
		private readonly acp: AcpPort,
	) {}

	async execute(
		scope: MachineOperationScope,
		input: ExecuteAcpRequest,
		maxOutputBytes: number,
		client: MachineClientIdentity,
	): Promise<ExecuteAcpResult> {
		let machine: MachineConnection | null = null;
		let dispatched = false;
		let failure: unknown = null;
		try {
			const opened = await this.machines.open({
				targetId: scope.targetId,
				expectedFingerprint: scope.fingerprint,
				timeoutMs: scope.timeoutMs,
				signal: scope.signal,

				validate: () => scope.validate(),
			});
			machine = opened.machine;
			await scope.validate();
			dispatched = true;
			const command = await this.commands.open(
				(text, signal) => opened.machine.openRawCommand(text, signal),
				{ kind: 'argv', argv: input.argv.map((arg) => arg) },
				input.cwd,
				scope.signal,
			);
			const result = await this.acp.execute(
				command,
				{
					cwd: input.cwd,
					prompt: input.prompt,
					maxOutputBytes,
					clientName: client.name,
					clientVersion: client.version,
				},
				{
					signal: scope.signal,

					permission: async (value, signal) => {
						await scope.validate();
						const response = await input.permission(
							{
								sessionId: value.sessionId,
								toolCallId: value.toolCallId,
								requestId: value.requestId,
								title: value.title,
								kind: value.kind,
								inputJson: value.inputJson,
							},
							signal,
						);
						return {
							decision: response.decision,

							delivered: () => response.delivered(),
						};
					},
				},
			);
			await scope.validate();
			return { text: result.text, stopReason: result.stopReason };
		} catch (cause) {
			failure =
				cause instanceof RemoteResourceCleanupFailure
					? cause
					: new RemoteFileFailure(
							dispatched && !(cause instanceof MachineDispatchFailure && cause.outcome !== 'unknown')
								? 'operation_unknown'
								: cause instanceof RemoteHostKeyUntrustedError
									? 'host_key_untrusted'
									: 'remote_unavailable',
							{ cause },
						);
			throw failure;
		} finally {
			if (machine) {
				try {
					await machine.close();
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
				}
			}
		}
	}
}
