import os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';

export interface LocalSystemStatus {
  cpuPercent: number;
  memPercent: number;
  memUsed: number;
  memTotal: number;
  diskPercent?: number;
  diskUsed?: number;
  diskTotal?: number;
  cpuModel?: string;
  osName?: string;
  uptimeSeconds: number;
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const readCpuSnapshot = (): CpuSnapshot => {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
};

let previousCpuSnapshot = readCpuSnapshot();

const readCpuPercent = (): number => {
  const current = readCpuSnapshot();
  const idleDelta = current.idle - previousCpuSnapshot.idle;
  const totalDelta = current.total - previousCpuSnapshot.total;
  previousCpuSnapshot = current;
  if (totalDelta <= 0) return 0;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
};

const readMemoryStatus = async (): Promise<Pick<LocalSystemStatus, 'memPercent' | 'memUsed' | 'memTotal'>> => {
  try {
    const raw = await readFile('/proc/meminfo', 'utf8');
    const values = new Map<string, number>();
    for (const line of raw.split('\n')) {
      const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/);
      if (match) values.set(match[1], Number(match[2]));
    }
    const totalKb = values.get('MemTotal') ?? 0;
    if (totalKb > 0) {
      const fallbackAvailableKb =
        (values.get('MemFree') ?? 0)
        + (values.get('Buffers') ?? 0)
        + (values.get('Cached') ?? 0)
        + (values.get('SReclaimable') ?? 0)
        - (values.get('Shmem') ?? 0);
      const availableKb = Math.max(0, Math.min(totalKb, values.get('MemAvailable') ?? fallbackAvailableKb));
      const usedKb = Math.max(0, totalKb - availableKb);
      return {
        memTotal: totalKb / 1024,
        memUsed: usedKb / 1024,
        memPercent: clampPercent((usedKb / totalKb) * 100),
      };
    }
  } catch {
    // Non-Linux platforms fall back to Node's portable memory metrics.
  }

  const totalBytes = os.totalmem();
  const usedBytes = Math.max(0, totalBytes - os.freemem());
  return {
    memTotal: totalBytes / 1024 / 1024,
    memUsed: usedBytes / 1024 / 1024,
    memPercent: totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0,
  };
};

const readDiskStatus = async (): Promise<Pick<LocalSystemStatus, 'diskPercent' | 'diskUsed' | 'diskTotal'>> => {
  try {
    const stats = await statfs('/');
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const freeBytes = Number(stats.bfree) * blockSize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    if (totalBytes <= 0) return {};
    return {
      diskTotal: totalBytes / 1024,
      diskUsed: usedBytes / 1024,
      diskPercent: clampPercent((usedBytes / totalBytes) * 100),
    };
  } catch {
    return {};
  }
};

export async function getLocalSystemStatus(): Promise<LocalSystemStatus> {
  const [memory, disk] = await Promise.all([readMemoryStatus(), readDiskStatus()]);
  const cpuModel = os.cpus()[0]?.model?.trim();
  return {
    cpuPercent: readCpuPercent(),
    ...memory,
    ...disk,
    cpuModel: cpuModel || undefined,
    osName: `${os.type()} ${os.release()}`,
    uptimeSeconds: Math.round(os.uptime()),
  };
}
