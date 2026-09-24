import { spawn } from 'node:child_process';
import { MANAGED_PROCESS_DETACHED, registerManagedProcess, signalManagedProcess } from '../managed-process';

export interface JobResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface JobRunOptions {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

const MAX_ARGV_ITEMS = 512;
const MAX_ARG_BYTES = 8 * 1024;
const MAX_TOTAL_ARG_BYTES = 128 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 5 * 60 * 1000;

const completeUtf8Prefix = (value: Buffer): Buffer => {
  if (value.byteLength === 0) return value;
  let start = value.byteLength - 1;
  while (start > 0 && (value[start]! & 0xc0) === 0x80 && value.byteLength - start < 4) start -= 1;
  const lead = value[start]!;
  const expected =
    lead < 0x80
      ? 1
      : lead >= 0xc2 && lead <= 0xdf
        ? 2
        : lead >= 0xe0 && lead <= 0xef
          ? 3
          : lead >= 0xf0 && lead <= 0xf4
            ? 4
            : 1;
  return expected > value.byteLength - start ? value.subarray(0, start) : value;
};

const decodeUtf8 = (chunks: readonly Buffer[]): string => {
  if (chunks.length === 0) return '';
  return completeUtf8Prefix(Buffer.concat(chunks)).toString('utf8');
};

export class JobRunner {
  run(
    argv: readonly string[],
    cwd = '/workspace/work',
    maxBytes = 256 * 1024,
    timeoutMs = 60_000,
    options: JobRunOptions = {},
  ): Promise<JobResult> {
    if (
      !Array.isArray(argv) ||
      (!options.executable && argv.length < 1) ||
      argv.length > MAX_ARGV_ITEMS ||
      argv.some(
        (value) =>
          typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > MAX_ARG_BYTES,
      ) ||
      argv.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0) > MAX_TOTAL_ARG_BYTES
    ) {
      throw new Error('JOB_INVALID');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OUTPUT_BYTES) {
      throw new Error('JOB_OUTPUT_LIMIT_INVALID');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error('JOB_TIMEOUT_INVALID');
    }

    const executable = options.executable ?? argv[0]!;
    if (!executable || executable.includes('\0') || Buffer.byteLength(executable, 'utf8') > MAX_ARG_BYTES) {
      throw new Error('JOB_INVALID');
    }
    const args = options.executable ? [...argv] : argv.slice(1);
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: MANAGED_PROCESS_DETACHED,
        env: options.env ?? {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          LANG: process.env.LANG ?? 'C.UTF-8',
        },
      });
      registerManagedProcess(child, 'job', cwd);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let truncated = false;
      let total = 0;
      let timedOut = false;
      let killTimer: NodeJS.Timeout | null = null;
      let settled = false;

      const terminate = (): void => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        signalManagedProcess(child, 'SIGTERM');
        killTimer = setTimeout(() => signalManagedProcess(child, 'SIGKILL'), 2_000);
        killTimer.unref?.();
      };
      const onAbort = (): void => terminate();
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const append = (kind: 'out' | 'err', chunk: Buffer): void => {
        const remaining = Math.max(0, maxBytes - total);
        const accepted = chunk.subarray(0, remaining);
        total += accepted.byteLength;
        if (accepted.byteLength < chunk.byteLength) truncated = true;
        if (accepted.byteLength === 0) return;
        const retained = Buffer.from(accepted);
        if (kind === 'out') stdoutChunks.push(retained);
        else stderrChunks.push(retained);
      };

      child.stdout.on('data', (chunk: Buffer) => append('out', chunk));
      child.stderr.on('data', (chunk: Buffer) => append('err', chunk));
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.once('exit', () => {
        // close 会等待所有继承 stdio 的 descendants；leader 一退出就先清组，避免后台进程卡住 job 完成。
        signalManagedProcess(child, 'SIGKILL');
      });
      child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', onAbort);
        resolve({
          exitCode,
          signal,
          stdout: decodeUtf8(stdoutChunks),
          stderr: decodeUtf8(stderrChunks),
          truncated,
          timedOut,
        });
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
      timeout.unref?.();
      if (options.signal?.aborted) onAbort();
    });
  }
}
