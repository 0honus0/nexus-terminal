import type {
	MachineCommandExecutor,
	MachineExecuteOptions,
	MachineCommandResult,
	MachineCommand,
} from '../ssh/ssh-port.js';

export type NativeCommand = { kind: 'argv'; argv: string[] } | { kind: 'shell'; script: string };

export interface NativeCommandBatchResult {
	results: Array<
		| { index: number; status: 'not_started' }
		| {
				index: number;
				status: 'completed' | 'nonzero';
				exitCode: number;
				stdout: string;
				stderr: string;
				truncated: boolean;
		  }
	>;
}

export interface NativeCommandBatchOptions extends MachineExecuteOptions {
	onOutput?(index: number, stream: 'stdout' | 'stderr', text: string): void;
}

export interface CommandPort {
	executeBatch(
		open: (command: string, signal: AbortSignal) => Promise<MachineCommand>,
		commands: NativeCommand[],
		cwd: string | null,
		onError: 'stop' | 'continue',
		options: NativeCommandBatchOptions,
	): Promise<NativeCommandBatchResult>;
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
