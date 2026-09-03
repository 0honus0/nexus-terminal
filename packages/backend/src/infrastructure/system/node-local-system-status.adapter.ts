import os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import type { LocalSystemStatus, LocalSystemStatusProvider } from '../../modules/system/local-system-status.port';
interface Cpu {
  idle: number;
  total: number;
}
const clamp = (v: number) => Math.min(100, Math.max(0, v));
const snapshot = (): Cpu => {
  let idle = 0,
    total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
  }
  return { idle, total };
};
export class NodeLocalSystemStatusAdapter implements LocalSystemStatusProvider {
  private previous = snapshot();
  async collect(): Promise<LocalSystemStatus> {
    const current = snapshot();
    const idle = current.idle - this.previous.idle,
      total = current.total - this.previous.total;
    this.previous = current;
    const cpuPercent = total > 0 ? clamp((1 - idle / total) * 100) : 0;
    const [memory, disk] = await Promise.all([this.memory(), this.disk()]);
    const cpuModel = os.cpus()[0]?.model?.trim();
    return {
      cpuPercent,
      ...memory,
      ...disk,
      cpuModel: cpuModel || undefined,
      osName: `${os.type()} ${os.release()}`,
      uptimeSeconds: Math.round(os.uptime()),
    };
  }
  private async memory() {
    try {
      const raw = await readFile('/proc/meminfo', 'utf8');
      const values = new Map<string, number>();
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/);
        if (m) values.set(m[1]!, Number(m[2]));
      }
      const total = values.get('MemTotal') ?? 0;
      if (total > 0) {
        const fallback =
          (values.get('MemFree') ?? 0) +
          (values.get('Buffers') ?? 0) +
          (values.get('Cached') ?? 0) +
          (values.get('SReclaimable') ?? 0) -
          (values.get('Shmem') ?? 0);
        const available = Math.max(0, Math.min(total, values.get('MemAvailable') ?? fallback));
        const used = total - available;
        return { memTotal: total / 1024, memUsed: used / 1024, memPercent: clamp((used / total) * 100) };
      }
    } catch {}
    const total = os.totalmem(),
      used = Math.max(0, total - os.freemem());
    return {
      memTotal: total / 1024 / 1024,
      memUsed: used / 1024 / 1024,
      memPercent: total > 0 ? clamp((used / total) * 100) : 0,
    };
  }
  private async disk() {
    try {
      const s = await statfs('/');
      const block = Number(s.bsize),
        total = Number(s.blocks) * block,
        free = Number(s.bfree) * block,
        used = Math.max(0, total - free);
      return total > 0
        ? { diskTotal: total / 1024, diskUsed: used / 1024, diskPercent: clamp((used / total) * 100) }
        : {};
    } catch {
      return {};
    }
  }
}
