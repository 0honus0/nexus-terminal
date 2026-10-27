import { randomUUID } from 'node:crypto';
import { toolProbe } from '../tool-probe.js';
import type { MachineConnection, MachineCommandResult } from '../../ssh/ssh-port.js';
import { MachineDispatchFailure } from '../../ssh/ssh-port.js';
import {
	ToolExecutionFailure,
	type RemoteToolInstaller,
	type ToolEnvironment,
	type InstallableTool,
	type PackageManager,
	type InstallPrivilege,
	type ToolExecutionScope,
} from '../tool-port.js';

const managers: readonly PackageManager[] = ['apt-get', 'dnf', 'yum', 'apk', 'zypper', 'pacman'];

const sshPackages: Record<PackageManager, string> = {
	'apt-get': 'openssh-client',
	dnf: 'openssh-clients',
	yum: 'openssh-clients',
	apk: 'openssh-client-default',
	zypper: 'openssh-clients',
	pacman: 'openssh',
};

function quote(value: string): string {
	return "'" + value.replace(/'/gu, "'\\''") + "'";
}

function packageFor(tool: InstallableTool, manager: PackageManager): string {
	if (tool === 'ssh' || tool === 'scp') {
		return sshPackages[manager];
	}
	if (tool === 'cp' || tool === 'ln' || tool === 'od') {
		return 'coreutils';
	}
	if (tool === 'zipinfo') {
		return 'unzip';
	}
	if (tool === 'xz') {
		return manager === 'apt-get' ? 'xz-utils' : 'xz';
	}
	return tool;
}

function installCommand(packages: string[], manager: PackageManager): string {
	const args = packages.map(quote).join(' ');
	switch (manager) {
		case 'apt-get':
			return 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y -- ' + args;
		case 'dnf':
		case 'yum':
			return manager + ' install -y -- ' + args;
		case 'apk':
			return 'apk add -- ' + args;
		case 'zypper':
			return 'zypper --non-interactive install -- ' + args;
		// Never refresh only the sync database: that creates unsupported partial upgrades.
		case 'pacman':
			return 'pacman -S --needed --noconfirm -- ' + args;
	}
}

async function execute(
	machine: MachineConnection,
	command: string,
	scope: ToolExecutionScope,
	writing: boolean,
	stdin?: string,
): Promise<MachineCommandResult> {
	try {
		scope.signal.throwIfAborted();
		const result = await machine.execute(command, {
			timeoutMs: scope.remaining(),
			maxOutputBytes: 32 * 1024,
			signal: scope.signal,
			...(stdin === undefined ? {} : { stdin }),
		});
		if (result.outcome.status === 'unknown') {
			throw new ToolExecutionFailure(writing ? 'operation_unknown' : 'unavailable');
		}
		return result;
	} catch (cause) {
		if (cause instanceof ToolExecutionFailure) {
			throw cause;
		}
		throw new ToolExecutionFailure(
			writing && !(cause instanceof MachineDispatchFailure && cause.outcome === 'not_started')
				? 'operation_unknown'
				: 'unavailable',
			{ cause },
		);
	}
}

export class PosixToolInstaller implements RemoteToolInstaller {
	async inspect(
		machine: MachineConnection,
		tools: readonly InstallableTool[],
		scope: ToolExecutionScope,
	): Promise<ToolEnvironment> {
		const command = [
			...tools.map((tool) => '{ ' + toolProbe(tool) + '; } || printf "%s\\n" ' + quote('missing:' + tool)),
			'if [ "$(id -u)" = 0 ]; then printf "privilege:root\\n"; elif command -v sudo >/dev/null 2>&1; then if sudo -n -- true </dev/null >/dev/null 2>&1; then printf "privilege:sudo\\n"; else printf "privilege:password\\n"; fi; else printf "privilege:unavailable\\n"; fi',
			'for manager in apt-get dnf yum apk zypper pacman; do if command -v "$manager" >/dev/null 2>&1; then printf "manager:%s\\n" "$manager"; break; fi; done',
			'printf "complete\\n"',
		].join('\n');
		const result = await execute(machine, command, scope, false);
		if (result.truncated || result.outcome.status !== 'completed') {
			throw new ToolExecutionFailure('unavailable');
		}
		const lines = result.stdout.trim().split(/\r?\n/u);
		if (lines.pop() !== 'complete') {
			throw new ToolExecutionFailure('unavailable');
		}
		const missing: InstallableTool[] = [];
		let manager: PackageManager | null = null;
		let privilege: InstallPrivilege | null = null;
		for (const line of lines) {
			const tool = tools.find((value) => line === 'missing:' + value);
			const foundManager = managers.find((value) => line === 'manager:' + value);
			if (tool && !missing.includes(tool)) {
				missing.push(tool);
			} else if (foundManager && manager === null) {
				manager = foundManager;
			} else if (privilege === null && line === 'privilege:root') {
				privilege = 'root';
			} else if (privilege === null && line === 'privilege:sudo') {
				privilege = 'sudo';
			} else if (privilege === null && line === 'privilege:password') {
				privilege = 'password';
			} else if (privilege === null && line === 'privilege:unavailable') {
				privilege = 'unavailable';
			} else {
				throw new ToolExecutionFailure('unavailable');
			}
		}
		if (privilege === null) {
			throw new ToolExecutionFailure('unavailable');
		}
		return { missing, manager, privilege };
	}

	async install(
		machine: MachineConnection,
		tools: readonly InstallableTool[],
		manager: PackageManager,
		privilege: Exclude<InstallPrivilege, 'unavailable'>,
		password: string | undefined,
		scope: ToolExecutionScope,
	): Promise<void> {
		const marker = 'NEXUS_INSTALL_' + randomUUID();
		const packages = [...new Set(tools.map((tool) => packageFor(tool, manager)))];
		const script =
			'printf "%s\\n" ' +
			quote(marker) +
			'\n(' +
			installCommand(packages, manager) +
			') </dev/null >/dev/null 2>&1';
		const command =
			(privilege === 'root' ? '' : privilege === 'sudo' ? 'sudo -n -- ' : "sudo -S -k -p '' -- ") +
			'sh -c ' +
			quote(script);
		const result = await execute(
			machine,
			command,
			scope,
			true,
			privilege === 'password' ? password + '\n' : undefined,
		);
		const started = result.stdout.split(/\r?\n/u).includes(marker);
		if (result.truncated || (!started && result.outcome.status === 'completed')) {
			throw new ToolExecutionFailure('operation_unknown');
		}
		if (!started || result.outcome.status !== 'completed') {
			throw new ToolExecutionFailure(
				started || privilege === 'root' ? 'installation_failed' : 'authentication_failed',
			);
		}
		const checked = await this.inspect(machine, tools, scope).catch((cause: unknown) => {
			throw new ToolExecutionFailure('operation_unknown', { cause });
		});
		if (checked.missing.length) {
			throw new ToolExecutionFailure('installation_failed');
		}
	}
}
