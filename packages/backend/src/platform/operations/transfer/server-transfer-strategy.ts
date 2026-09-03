import { quotePosixShellArg } from '../../execution/posix-shell';

export interface ServerTransferCommandInput {
  sourcePath: string;
  isDirectory: boolean;
  targetPath: string;
  executable: string;
  targetUserAndHost: string;
  targetPort: number;
  identityFile?: string;
  sshPassCommand?: string;
}

export interface ServerTransferStrategy {
  readonly method: 'rsync' | 'scp';
  build(input: ServerTransferCommandInput): string;
  parseProgress(output: string): number | undefined;
  requiresPty(input: ServerTransferCommandInput): boolean;
}

export class RsyncServerTransferStrategy implements ServerTransferStrategy {
  readonly method = 'rsync' as const;

  build(input: ServerTransferCommandInput): string {
    const targetBase = input.targetPath.endsWith('/') ? input.targetPath : `${input.targetPath}/`;
    const parts: string[] = [];
    if (input.sshPassCommand) parts.push(input.sshPassCommand);
    parts.push(quotePosixShellArg(input.executable), '-az --info=progress2');
    let ssh = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${input.targetPort}`;
    if (input.identityFile) ssh += ` -i ${quotePosixShellArg(input.identityFile)}`;
    parts.push(`-e ${quotePosixShellArg(ssh)}`);
    let source = quotePosixShellArg(input.sourcePath);
    if (input.isDirectory && !source.endsWith("/'")) source = `${source.slice(0, -1)}/'`;
    parts.push(source, quotePosixShellArg(`${input.targetUserAndHost}:${targetBase}`));
    return parts.join(' ');
  }

  parseProgress(output: string): number | undefined {
    const matches = [...output.matchAll(/(\d{1,3})%/g)];
    const value = matches.length ? matches[matches.length - 1]?.[1] : undefined;
    return value ? Math.min(100, Number.parseInt(value, 10)) : undefined;
  }

  requiresPty(input: ServerTransferCommandInput): boolean {
    return Boolean(input.sshPassCommand);
  }
}

export class ScpServerTransferStrategy implements ServerTransferStrategy {
  readonly method = 'scp' as const;

  build(input: ServerTransferCommandInput): string {
    const targetBase = input.targetPath.endsWith('/') ? input.targetPath : `${input.targetPath}/`;
    const parts: string[] = [];
    if (input.sshPassCommand) parts.push(input.sshPassCommand);
    parts.push(
      quotePosixShellArg(input.executable),
      '-o StrictHostKeyChecking=no',
      '-o UserKnownHostsFile=/dev/null',
    );
    if (input.isDirectory) parts.push('-r');
    parts.push(`-P ${input.targetPort}`);
    if (input.identityFile) parts.push(`-i ${quotePosixShellArg(input.identityFile)}`);
    parts.push(quotePosixShellArg(input.sourcePath), quotePosixShellArg(`${input.targetUserAndHost}:${targetBase}`));
    return parts.join(' ');
  }

  parseProgress(output: string): number | undefined {
    const matches = [...output.matchAll(/(\d{1,3})%/g)];
    const value = matches.length ? matches[matches.length - 1]?.[1] : undefined;
    return value ? Math.min(100, Number.parseInt(value, 10)) : undefined;
  }

  requiresPty(input: ServerTransferCommandInput): boolean {
    return Boolean(input.sshPassCommand);
  }
}
