import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

export const MANAGED_PROCESS_DETACHED = process.platform !== 'win32';

export type ManagedProcessKind = 'job' | 'acp' | 'plugin' | 'pack';

interface ManagedProcessRecord {
  pid: number;
  startTime: string;
  kind: ManagedProcessKind;
  ownerId: string;
  registeredAt: number;
}

let registryFile: string | null = null;
const records = new Map<number, ManagedProcessRecord>();
const liveChildren = new Map<number, ChildProcess>();

const exited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

const processStartTime = (pid: number): string | null => {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').trim();
    const close = stat.lastIndexOf(') ');
    if (close < 0) return null;
    return stat.slice(close + 2).split(/\s+/)[19] ?? null;
  } catch {
    return null;
  }
};

const flushRegistry = (): void => {
  if (!registryFile) return;
  fs.mkdirSync(path.dirname(registryFile), { recursive: true, mode: 0o700 });
  const temp = `${registryFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify([...records.values()]), { mode: 0o600 });
  fs.renameSync(temp, registryFile);
};

const signalProcessGroup = (pid: number, signal: NodeJS.Signals): boolean => {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
};

export const initializeManagedProcessRegistry = (root: string): number => {
  registryFile = path.join(root, 'state', 'managed-processes.json');
  records.clear();
  liveChildren.clear();
  let stale: ManagedProcessRecord[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      stale = parsed.filter(
        (item): item is ManagedProcessRecord =>
          Boolean(item) &&
          typeof item === 'object' &&
          Number.isSafeInteger((item as ManagedProcessRecord).pid) &&
          typeof (item as ManagedProcessRecord).startTime === 'string' &&
          typeof (item as ManagedProcessRecord).kind === 'string' &&
          typeof (item as ManagedProcessRecord).ownerId === 'string',
      );
    }
  } catch {
    stale = [];
  }

  let reaped = 0;
  for (const record of stale) {
    if (processStartTime(record.pid) !== record.startTime) continue;
    if (signalProcessGroup(record.pid, 'SIGKILL')) reaped += 1;
  }
  flushRegistry();
  return reaped;
};

export const registerManagedProcess = (child: ChildProcess, kind: ManagedProcessKind, ownerId: string): void => {
  if (!MANAGED_PROCESS_DETACHED || !child.pid || !registryFile) return;
  const startTime = processStartTime(child.pid);
  if (!startTime) {
    signalManagedProcess(child, 'SIGKILL');
    throw new Error('MANAGED_PROCESS_REGISTRATION_FAILED');
  }
  const record: ManagedProcessRecord = {
    pid: child.pid,
    startTime,
    kind,
    ownerId: ownerId.slice(0, 512),
    registeredAt: Math.floor(Date.now() / 1000),
  };
  records.set(child.pid, record);
  liveChildren.set(child.pid, child);
  flushRegistry();
  child.once('close', () => {
    if (records.get(record.pid)?.startTime !== record.startTime) return;
    records.delete(record.pid);
    liveChildren.delete(record.pid);
    flushRegistry();
  });
};

export const terminateAllManagedProcesses = async (): Promise<void> => {
  await Promise.all([...liveChildren.values()].map((child) => terminateManagedProcess(child).catch(() => undefined)));
  for (const record of [...records.values()]) {
    if (processStartTime(record.pid) === record.startTime) signalProcessGroup(record.pid, 'SIGKILL');
    records.delete(record.pid);
  }
  liveChildren.clear();
  flushRegistry();
};

/**
 * Runner-managed 子进程在 Linux 上独占 process group，生命周期操作必须整组发送信号，
 * 避免 shell、ACP 或 Plugin 派生的孙进程在 Workspace stop/restart 后变成孤儿进程。
 */
export const signalManagedProcess = (child: ChildProcess, signal: NodeJS.Signals): boolean => {
  // detached group 可能在 leader 退出后仍有孙进程存活，因此优先按 group id 清理。
  if (MANAGED_PROCESS_DETACHED && child.pid) {
    return signalProcessGroup(child.pid, signal);
  }
  if (exited(child)) return true;
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
};

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      resolve(value);
    };
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(exited(child)), timeoutMs);
    timer.unref?.();
    child.once('close', onClose);
  });
};

export const terminateManagedProcess = async (child: ChildProcess, graceMs = 2_000): Promise<void> => {
  if (exited(child)) {
    signalManagedProcess(child, 'SIGKILL');
    return;
  }
  const gracefulExit = waitForExit(child, graceMs);
  signalManagedProcess(child, 'SIGTERM');
  if (await gracefulExit) return;

  const forcedExit = waitForExit(child, 1_000);
  signalManagedProcess(child, 'SIGKILL');
  if (!(await forcedExit)) throw new Error('MANAGED_PROCESS_TERMINATION_TIMEOUT');
};
