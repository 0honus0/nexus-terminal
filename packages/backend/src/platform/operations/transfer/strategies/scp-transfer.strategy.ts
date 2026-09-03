import type { ExecOptions } from 'ssh2';
import { quotePosixShellArg } from '../../../execution/posix-shell';
import type { TransferCommandBuildInput, TransferCommandStrategy } from './transfer-command.strategy';

export class ScpTransferStrategy implements TransferCommandStrategy {
  readonly method = 'scp' as const;

  build(input: TransferCommandBuildInput): string {
    const remoteBase = input.targetPath.endsWith('/') ? input.targetPath : `${input.targetPath}/`;
    const commandParts: string[] = [];
    if (input.sshPassCommand) commandParts.push(input.sshPassCommand);
    commandParts.push(quotePosixShellArg(input.executable));
    commandParts.push('-o StrictHostKeyChecking=no');
    commandParts.push('-o UserKnownHostsFile=/dev/null');
    if (input.isDirectory) commandParts.push('-r');
    commandParts.push(`-P ${input.targetPort}`);
    if (input.identityFile) commandParts.push(`-i ${quotePosixShellArg(input.identityFile)}`);
    commandParts.push(quotePosixShellArg(input.sourcePath));
    commandParts.push(quotePosixShellArg(`${input.targetUserAndHost}:${remoteBase}`));
    return commandParts.join(' ');
  }

  parseProgress(_stdout: string): number | undefined {
    return 50;
  }

  execOptions(input: TransferCommandBuildInput): ExecOptions {
    return input.sshPassCommand ? { pty: true } : {};
  }
}
