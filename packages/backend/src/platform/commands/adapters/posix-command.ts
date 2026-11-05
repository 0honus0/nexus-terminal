import type { NativeCommandBatchOptions } from '../command-port.js';
import type { CommandPort, NativeCommand, NativeCommandBatchResult } from '../command-port.js';
import { executePosixBatch } from './posix-command-batch.js';
import type {
	MachineCommandExecutor,
	MachineExecuteOptions,
	MachineCommandResult,
	MachineCommand,
} from '../../ssh/ssh-port.js';

function quote(value: string): string {
	if (value.includes('\0')) {
		throw new Error('Invalid POSIX command argument');
	}
	return "'" + value.replaceAll("'", "'\\''") + "'";
}

function commandText(command: NativeCommand, cwd: string | null): string {
	const invocation =
		command.kind === 'argv' ? 'exec ' + command.argv.map(quote).join(' ') : 'exec sh -c ' + quote(command.script);
	return (cwd === null ? '' : 'cd ' + quote(cwd) + ' && ') + invocation;
}

/** Source is executable only in explicit shell mode; argv never receives shell interpolation. */
export class PosixCommandAdapter implements CommandPort {
	executeBatch(
		open: (command: string, signal: AbortSignal) => Promise<MachineCommand>,
		commands: NativeCommand[],
		cwd: string | null,
		onError: 'stop' | 'continue',
		options: NativeCommandBatchOptions,
	): Promise<NativeCommandBatchResult> {
		return executePosixBatch(
			open,
			commands.map((command) => commandText(command, cwd)),
			onError,
			options,
		);
	}

	open(
		open: (command: string, signal: AbortSignal) => Promise<MachineCommand>,
		command: NativeCommand,
		cwd: string,
		signal: AbortSignal,
	): Promise<MachineCommand> {
		return open(commandText(command, cwd), signal);
	}

	execute(
		execute: MachineCommandExecutor,
		command: NativeCommand,
		cwd: string | null,
		options: MachineExecuteOptions,
	): Promise<MachineCommandResult> {
		return execute(commandText(command, cwd), options);
	}
}
