import type {
	MachineCommandExecutor,
	MachineExecuteOptions,
	MachineCommandResult,
	MachineCommand,
} from '../ssh/ssh-port.js';

export type NativeCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; script: string };

export interface CommandPort {
	open(
		open: (command: string, signal: AbortSignal) => Promise<MachineCommand>,
		command: NativeCommand,
		cwd: string,
		signal: AbortSignal,
	): Promise<MachineCommand>;
	execute(
		execute: MachineCommandExecutor,
		command: NativeCommand,
		cwd: string | null,
		options: MachineExecuteOptions,
	): Promise<MachineCommandResult>;
}
