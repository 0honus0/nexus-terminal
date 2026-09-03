import type { ExecutionSession } from '../execution/execution-session';
import type { ServerStatus, ServerStatusCollector } from './server-status.port';

interface NetworkStats {
  [name: string]: { rx: number; tx: number };
}
interface StaticInfo {
  osName: string;
  cpuModel: string;
  netInterface?: string;
}
const PREFIX = '__NEXUS_STATUS_';
const SECTIONS = [
  'OS_RELEASE',
  'CPU_MODEL',
  'MEMINFO',
  'DISK',
  'PROC_STAT',
  'LOADAVG',
  'NET_ROUTE',
  'NET_DEV',
] as const;
type Section = (typeof SECTIONS)[number];

/** Reusable POSIX/Linux status capability over the abstract ExecutionSession. */
export class PosixServerStatusCollector implements ServerStatusCollector {
  private readonly previousCpu = new Map<
    string,
    { total: number; idle: number; timestamp: number; lastPercent: number }
  >();
  private readonly previousNet = new Map<string, { rx: number; tx: number; timestamp: number }>();
  private readonly staticInfo = new Map<string, StaticInfo>();
  clear(key: string) {
    this.previousCpu.delete(key);
    this.previousNet.delete(key);
    this.staticInfo.delete(key);
  }
  async collect(session: ExecutionSession, key: string): Promise<ServerStatus> {
    const timestamp = Date.now();
    const includeStatic = !this.staticInfo.has(key);
    const output = (
      await session.execute({ command: this.command(includeStatic), timeoutMs: 15_000, maxOutputBytes: 1024 * 1024 })
    ).stdout;
    const sections = this.parseSections(output);
    let info = this.staticInfo.get(key);
    if (!info) {
      const net = this.parseNet(sections.get('NET_DEV') ?? '');
      info = {
        osName: this.parseOs(sections.get('OS_RELEASE') ?? ''),
        cpuModel: (sections.get('CPU_MODEL') ?? '').trim() || 'Unknown',
        netInterface: this.defaultInterface(sections.get('NET_ROUTE') ?? '', net),
      };
      this.staticInfo.set(key, info);
    }
    const status: ServerStatus = {
      timestamp,
      osName: info.osName,
      cpuModel: info.cpuModel,
      netInterface: info.netInterface,
    };
    const mem = sections.get('MEMINFO');
    if (mem) Object.assign(status, this.parseMemory(mem));
    const disk = sections.get('DISK');
    if (disk) Object.assign(status, this.parseDisk(disk));
    const cpu = this.parseCpu(sections.get('PROC_STAT') ?? '');
    if (cpu) {
      const previous = this.previousCpu.get(key);
      let percent = previous?.lastPercent ?? 0;
      if (previous && previous.timestamp < timestamp) {
        const total = cpu.total - previous.total;
        const idle = cpu.idle - previous.idle;
        if (total > 0 && idle >= 0)
          percent = Number((Math.max(0, Math.min(1, 1 - Math.min(idle, total) / total)) * 100).toFixed(1));
      }
      status.cpuPercent = percent;
      this.previousCpu.set(key, { ...cpu, timestamp, lastPercent: percent });
    }
    const loads = (sections.get('LOADAVG') ?? '').trim().split(/\s+/).slice(0, 3).map(Number);
    if (loads.length === 3 && loads.every(Number.isFinite)) status.loadAvg = loads;
    const net = this.parseNet(sections.get('NET_DEV') ?? '');
    let netInterface = info.netInterface;
    if (!netInterface || !net[netInterface]) {
      netInterface = Object.keys(net).find((n) => n !== 'lo');
      info.netInterface = netInterface;
      status.netInterface = netInterface;
    }
    if (netInterface && net[netInterface]) {
      const current = net[netInterface]!;
      const previous = this.previousNet.get(key);
      if (previous && previous.timestamp < timestamp) {
        const seconds = (timestamp - previous.timestamp) / 1000;
        status.netRxRate = seconds > 0 ? Math.max(0, Math.round((current.rx - previous.rx) / seconds)) : 0;
        status.netTxRate = seconds > 0 ? Math.max(0, Math.round((current.tx - previous.tx) / seconds)) : 0;
      } else {
        status.netRxRate = 0;
        status.netTxRate = 0;
      }
      this.previousNet.set(key, { ...current, timestamp });
    }
    return status;
  }
  private command(includeStatic: boolean) {
    const marker = (name: Section) => `printf '\\n${PREFIX}${name}__\\n';`;
    const commands = ['export LC_ALL=C;'];
    if (includeStatic)
      commands.push(
        marker('OS_RELEASE'),
        'cat /etc/os-release 2>/dev/null || true;',
        marker('CPU_MODEL'),
        'awk -F: \'/model name|Hardware|Processor/{value=$2; sub(/^[[:space:]]+/, "", value); if (value != "") { print value; exit }}\' /proc/cpuinfo 2>/dev/null || true;',
        marker('NET_ROUTE'),
        'cat /proc/net/route 2>/dev/null || true;',
      );
    commands.push(
      marker('MEMINFO'),
      'cat /proc/meminfo 2>/dev/null || true;',
      marker('DISK'),
      'df -kP / 2>/dev/null || df -k / 2>/dev/null || true;',
      marker('PROC_STAT'),
      "sed -n '1p' /proc/stat 2>/dev/null || true;",
      marker('LOADAVG'),
      'cat /proc/loadavg 2>/dev/null || true;',
      marker('NET_DEV'),
      'cat /proc/net/dev 2>/dev/null || true;',
    );
    return commands.join(' ');
  }
  private parseSections(output: string) {
    const result = new Map<Section, string>();
    let current: Section | null = null;
    const lines = new Map<Section, string[]>();
    for (const line of output.replace(/\r/g, '').split('\n')) {
      const match = line.match(/^__NEXUS_STATUS_([A-Z_]+)__$/);
      if (match && SECTIONS.includes(match[1] as Section)) {
        current = match[1] as Section;
        if (!lines.has(current)) lines.set(current, []);
        continue;
      }
      if (current) lines.get(current)?.push(line);
    }
    for (const [name, value] of lines) result.set(name, value.join('\n').trim());
    return result;
  }
  private parseOs(output: string) {
    return output.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? output.match(/^NAME="?([^"\n]+)"?/m)?.[1] ?? 'Unknown';
  }
  private defaultInterface(route: string, net: NetworkStats) {
    for (const line of route.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length >= 4 && fields[1] === '00000000') return fields[0];
    }
    return Object.keys(net).find((name) => name !== 'lo');
  }
  private parseNet(output: string): NetworkStats {
    const result: NetworkStats = {};
    for (const line of output.split('\n').slice(2)) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const name = line.slice(0, separator).trim();
      const fields = line
        .slice(separator + 1)
        .trim()
        .split(/\s+/)
        .map(Number);
      if (name && fields.length >= 9 && Number.isFinite(fields[0]) && Number.isFinite(fields[8]))
        result[name] = { rx: fields[0]!, tx: fields[8]! };
    }
    return result;
  }
  private parseDisk(output: string): Pick<ServerStatus, 'diskTotal' | 'diskUsed' | 'diskPercent'> {
    const lines = output
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);
    const data = lines.slice(1).find((line) => line.endsWith(' /')) ?? lines.at(-1) ?? '';
    const fields = data.split(/\s+/);
    const percentField = fields.find((v) => /^\d+%$/.test(v));
    const total = Number(fields[1]),
      used = Number(fields[2]),
      percent = percentField ? Number(percentField.slice(0, -1)) : NaN;
    return {
      diskTotal: Number.isFinite(total) ? total : undefined,
      diskUsed: Number.isFinite(used) ? used : undefined,
      diskPercent: Number.isFinite(percent) ? percent : undefined,
    };
  }
  private parseMemory(
    output: string,
  ): Pick<ServerStatus, 'memTotal' | 'memUsed' | 'memPercent' | 'swapTotal' | 'swapUsed' | 'swapPercent'> {
    const values = new Map<string, number>();
    for (const line of output.split('\n')) {
      const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/);
      if (match) values.set(match[1]!, Number(match[2]));
    }
    const total = values.get('MemTotal');
    if (!total || total <= 0) throw new Error('/proc/meminfo 中缺少有效的 MemTotal');
    const fallback =
      (values.get('MemFree') ?? 0) +
      (values.get('Buffers') ?? 0) +
      (values.get('Cached') ?? 0) +
      (values.get('SReclaimable') ?? 0) -
      (values.get('Shmem') ?? 0);
    const available = Math.max(0, Math.min(total, values.get('MemAvailable') ?? fallback));
    const used = total - available;
    const swapTotal = values.get('SwapTotal') ?? 0;
    const swapFree = Math.max(0, Math.min(swapTotal, values.get('SwapFree') ?? 0));
    const swapUsed = swapTotal - swapFree;
    return {
      memTotal: Math.round(total / 1024),
      memUsed: Math.round(used / 1024),
      memPercent: Number(((used / total) * 100).toFixed(1)),
      swapTotal: Math.round(swapTotal / 1024),
      swapUsed: Math.round(swapUsed / 1024),
      swapPercent: swapTotal > 0 ? Number(((swapUsed / swapTotal) * 100).toFixed(1)) : 0,
    };
  }
  private parseCpu(output: string) {
    const line = output.split('\n').find((v) => v.startsWith('cpu '));
    if (!line) return null;
    const fields = line.trim().split(/\s+/).slice(1).map(Number);
    if (fields.length < 4 || fields.slice(0, 4).some((v) => !Number.isFinite(v))) return null;
    const idle = fields[3]! + (Number.isFinite(fields[4]) ? fields[4]! : 0);
    const total = fields.slice(0, 8).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
    return Number.isFinite(total) && Number.isFinite(idle) ? { total, idle } : null;
  }
}
