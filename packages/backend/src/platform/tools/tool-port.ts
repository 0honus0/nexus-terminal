import type { MachineConnection } from '../ssh/ssh-port.js';

export type InstallableTool =
	| 'ssh'
	| 'scp'
	| 'sshpass'
	| 'rsync'
	| 'zip'
	| 'unzip'
	| 'zipinfo'
	| 'tar'
	| 'gzip'
	| 'bzip2'
	| 'xz'
	| 'cp'
	| 'ln'
	| 'od'
	| 'grep';

export type PackageManager = 'apt-get' | 'dnf' | 'yum' | 'apk' | 'zypper' | 'pacman';

export type InstallPrivilege = 'root' | 'sudo' | 'password' | 'unavailable';

export interface ToolEnvironment {
	missing: InstallableTool[];
	manager: PackageManager | null;
	privilege: InstallPrivilege;
}

export interface ToolExecutionScope {
	signal: AbortSignal;
	remaining(): number;
}

export class ToolExecutionFailure extends Error {
	constructor(
		readonly reason: 'unavailable' | 'authentication_failed' | 'installation_failed' | 'operation_unknown',
		options?: ErrorOptions,
	) {
		super('Remote tool execution failed', options);
	}
}

export interface RemoteToolInstaller {
	inspect(
		machine: MachineConnection,
		tools: readonly InstallableTool[],
		scope: ToolExecutionScope,
	): Promise<ToolEnvironment>;
	install(
		machine: MachineConnection,
		tools: readonly InstallableTool[],
		manager: PackageManager,
		privilege: Exclude<InstallPrivilege, 'unavailable'>,
		password: string | undefined,
		scope: ToolExecutionScope,
	): Promise<void>;
}
