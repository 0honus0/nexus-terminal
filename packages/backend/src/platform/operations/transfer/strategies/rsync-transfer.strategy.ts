import type { ExecOptions } from 'ssh2';
import { quotePosixShellArg } from '../../../execution/posix-shell';
import type { TransferCommandBuildInput, TransferCommandStrategy } from './transfer-command.strategy';

export class RsyncTransferStrategy implements TransferCommandStrategy {
  readonly method = 'rsync' as const;

  build(input: TransferCommandBuildInput): string {
    const remoteBase = input.targetPath.endsWith('/') ? input.targetPath : `${input.targetPath}/`;
    const commandParts: string[] = [];
    if (input.sshPassCommand) commandParts.push(input.sshPassCommand);
    commandParts.push(quotePosixShellArg(input.executable));
    commandParts.push('-avz --progress');

    let sshArgs = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${input.targetPort}`;
    if (input.identityFile) sshArgs += ` -i ${quotePosixShellArg(input.identityFile)}`;
    commandParts.push(`-e "${sshArgs}"`);

    let sourcePath = quotePosixShellArg(input.sourcePath);
    if (input.isDirectory && !sourcePath.endsWith("/'")) sourcePath = sourcePath.slice(0, -1) + "/'";
    commandParts.push(sourcePath);
    commandParts.push(quotePosixShellArg(`${input.targetUserAndHost}:${remoteBase}`));
    return commandParts.join(' ');
  }

  parseProgress(stdout: string): number | undefined {
    const match = stdout.match(/(\d+)%/);
    return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  }

  execOptions(input: TransferCommandBuildInput): ExecOptions {
    return input.sshPassCommand ? { pty: true } : {};
  }
}
