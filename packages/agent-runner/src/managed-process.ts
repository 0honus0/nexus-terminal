import type { ChildProcess } from 'node:child_process';

export const MANAGED_PROCESS_DETACHED = process.platform !== 'win32';

const exited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

/**
 * Runner-managed 子进程在 Linux 上独占 process group，生命周期操作必须整组发送信号，
 * 避免 shell、ACP 或 Plugin 派生的孙进程在 Workspace stop/restart 后变成孤儿进程。
 */
export const signalManagedProcess = (child: ChildProcess, signal: NodeJS.Signals): boolean => {
  // detached group 可能在 leader 退出后仍有孙进程存活，因此优先按 group id 清理。
  if (MANAGED_PROCESS_DETACHED && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
      return true;
    }
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
  await forcedExit;
};
