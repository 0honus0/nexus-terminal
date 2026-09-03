import type { ExecOptions } from 'ssh2';

export interface TransferCommandBuildInput {
  sourcePath: string;
  isDirectory: boolean;
  targetPath: string;
  executable: string;
  targetUserAndHost: string;
  targetPort: number;
  identityFile?: string;
  sshPassCommand?: string;
}

export interface TransferCommandStrategy {
  readonly method: 'rsync' | 'scp';
  build(input: TransferCommandBuildInput): string;
  parseProgress(stdout: string): number | undefined;
  execOptions(input: TransferCommandBuildInput): ExecOptions;
}
