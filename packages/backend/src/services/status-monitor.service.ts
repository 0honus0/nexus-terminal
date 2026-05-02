import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState } from '../websocket/types';
import { settingsService } from '../settings/settings.service';
import { getErrorMessage } from '../utils/AppError';

export interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  cpuModel?: string;
  netRxRate?: number; // Bytes per second
  netTxRate?: number; // Bytes per second
  netInterface?: string;
  osName?: string;
  loadAvg?: number[];
  timestamp: number;
}

interface NetworkStats {
  [interfaceName: string]: {
    rx_bytes: number;
    tx_bytes: number;
  };
}

// --- 健康检查数据采集器：通过 SSH 执行命令并解析原始数据 ---
class HealthCheckCollector {
  /**
   * 在 SSH 连接上执行单个命令
   */
  executeSshCommand(sshClient: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      sshClient.exec(command, { env: { LC_ALL: 'C' } }, (err, stream) => {
        if (err) {
          return reject(new Error(`执行命令 '${command}' 失败: ${err.message}`));
        }
        stream
          .on('close', () => resolve(output.trim()))
          .on('data', (data: Buffer) => {
            output += data.toString('utf8');
          })
          .stderr.on('data', () => {});
      });
    });
  }

  /** 解析 OS 名称 */
  async collectOsName(sshClient: Client): Promise<string | undefined> {
    try {
      const output = await this.executeSshCommand(sshClient, 'cat /etc/os-release');
      const nameMatch = output.match(/^PRETTY_NAME="?([^"]+)"?/m);
      return nameMatch ? nameMatch[1] : (output.match(/^NAME="?([^"]+)"?/m)?.[1] ?? 'Unknown');
    } catch {
      return undefined;
    }
  }

  /** 解析 CPU 型号 */
  async collectCpuModel(sshClient: Client): Promise<string> {
    try {
      let output = await this.executeSshCommand(
        sshClient,
        "cat /proc/cpuinfo | grep 'model name' | head -n 1"
      );
      const model = output.match(/model name\s*:\s*(.*)/i)?.[1].trim();
      if (model) return model;
    } catch {
      /* 继续尝试 lscpu */
    }
    try {
      const output = await this.executeSshCommand(sshClient, "lscpu | grep 'Model name:'");
      const model = output.match(/Model name:\s+(.*)/)?.[1].trim();
      if (model) return model;
    } catch {
      /* 忽略 */
    }
    return 'Unknown';
  }

  /** 解析内存和 Swap */
  async collectMemoryStats(
    sshClient: Client
  ): Promise<
    Pick<
      ServerStatus,
      'memTotal' | 'memUsed' | 'memPercent' | 'swapTotal' | 'swapUsed' | 'swapPercent'
    >
  > {
    const result: ReturnType<typeof this.collectMemoryStats> extends Promise<infer R> ? R : never =
      {
        swapTotal: 0,
        swapUsed: 0,
        swapPercent: 0,
      };
    try {
      let freeCommand = 'free -m';
      let isBusyBox = false;
      try {
        const busyboxCheck = await this.executeSshCommand(sshClient, 'busybox --help');
        if (busyboxCheck.includes('BusyBox')) {
          freeCommand = 'free';
          isBusyBox = true;
        }
      } catch {
        /* 默认 free -m */
      }
      const freeOutput = await this.executeSshCommand(sshClient, freeCommand);
      const lines = freeOutput.split('\n');
      const memLine = lines.find((line) => line.startsWith('Mem:'));
      const swapLine = lines.find((line) => line.startsWith('Swap:'));
      if (memLine) {
        const parts = memLine.split(/\s+/);
        if (parts.length >= 3) {
          let totalVal = parseInt(parts[1], 10);
          let usedVal = parseInt(parts[2], 10);
          if (isBusyBox) {
            totalVal = Math.round(totalVal / 1024);
            usedVal = Math.round(usedVal / 1024);
          }
          if (!Number.isNaN(totalVal) && !Number.isNaN(usedVal)) {
            result.memTotal = totalVal;
            result.memUsed = usedVal;
            result.memPercent =
              totalVal > 0 ? parseFloat(((usedVal / totalVal) * 100).toFixed(1)) : 0;
          }
        }
      }
      if (swapLine) {
        const parts = swapLine.split(/\s+/);
        if (parts.length >= 3) {
          let totalVal = parseInt(parts[1], 10);
          let usedVal = parseInt(parts[2], 10);
          if (isBusyBox) {
            totalVal = Math.round(totalVal / 1024);
            usedVal = Math.round(usedVal / 1024);
          }
          if (!Number.isNaN(totalVal) && !Number.isNaN(usedVal)) {
            result.swapTotal = totalVal;
            result.swapUsed = usedVal;
            result.swapPercent =
              totalVal > 0 ? parseFloat(((usedVal / totalVal) * 100).toFixed(1)) : 0;
          }
        }
      }
    } catch {
      /* 静默处理 */
    }
    return result;
  }

  /** 解析磁盘使用 */
  async collectDiskStats(
    sshClient: Client
  ): Promise<Pick<ServerStatus, 'diskTotal' | 'diskUsed' | 'diskPercent'>> {
    try {
      let dfOutput: string;
      try {
        dfOutput = await this.executeSshCommand(sshClient, 'df -kP /');
      } catch {
        try {
          dfOutput = await this.executeSshCommand(sshClient, 'df -k /');
        } catch {
          dfOutput = '';
        }
      }
      if (dfOutput) {
        for (const line of dfOutput.split('\n').slice(1)) {
          if (line.trim().endsWith(' /')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const total = parseInt(parts[1], 10);
              const used = parseInt(parts[2], 10);
              const percentStr = parts.find((p) => p.endsWith('%'));
              if (percentStr) {
                const m = percentStr.match(/(\d+)%/);
                if (!Number.isNaN(total) && !Number.isNaN(used) && m?.[1]) {
                  return { diskTotal: total, diskUsed: used, diskPercent: parseFloat(m[1]) };
                }
              }
            }
          }
        }
      }
    } catch {
      /* 静默处理 */
    }
    return {};
  }

  /** 解析负载均衡 */
  async collectLoadAvg(sshClient: Client): Promise<number[] | undefined> {
    try {
      const output = await this.executeSshCommand(sshClient, 'uptime');
      const match = output.match(/load average(?:s)?:\s*([\d.]+)[, ]?\s*([\d.]+)[, ]?\s*([\d.]+)/);
      if (match) return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
    } catch {
      /* 静默处理 */
    }
    return undefined;
  }

  /** 解析 /proc/net/dev */
  async parseProcNetDev(sshClient: Client): Promise<NetworkStats | null> {
    try {
      const output = await this.executeSshCommand(sshClient, 'cat /proc/net/dev');
      const lines = output.split('\n').slice(2);
      const stats: NetworkStats = {};
      for (const line of lines) {
        const parts = line.trim().split(/:\s+|\s+/);
        if (parts.length < 17) continue;
        const rx_bytes = parseInt(parts[1], 10);
        const tx_bytes = parseInt(parts[9], 10);
        if (!Number.isNaN(rx_bytes) && !Number.isNaN(tx_bytes)) {
          stats[parts[0]] = { rx_bytes, tx_bytes };
        }
      }
      return Object.keys(stats).length > 0 ? stats : null;
    } catch {
      return null;
    }
  }

  /** 获取默认网络接口 */
  async getDefaultInterface(sshClient: Client): Promise<string | null> {
    try {
      const output = await this.executeSshCommand(
        sshClient,
        "ip route get 1.1.1.1 | grep -oP 'dev\\s+\\K\\S+'"
      );
      if (output.trim()) return output.trim();
    } catch {
      /* 继续 fallback */
    }
    try {
      const output = await this.executeSshCommand(sshClient, 'cat /proc/net/dev');
      for (const line of output.split('\n').slice(2)) {
        const iface = line.trim().split(':')[0];
        if (iface && iface !== 'lo') return iface;
      }
    } catch {
      /* 忽略 */
    }
    return null;
  }

  /** 解析 /proc/stat 获取 CPU 时间 */
  parseProcStat(output: string): { total: number; idle: number } | null {
    try {
      const cpuLine = output.split('\n').find((line) => line.startsWith('cpu '));
      if (!cpuLine) return null;
      const fields = cpuLine.trim().split(/\s+/).slice(1).map(Number);
      if (fields.length < 4 || fields.slice(0, 4).some(Number.isNaN)) return null;
      const idle = fields[3];
      const total = fields.reduce((sum, v) => sum + (Number.isNaN(v) ? 0 : v), 0);
      if (Number.isNaN(total) || Number.isNaN(idle)) return null;
      return { total, idle };
    } catch {
      return null;
    }
  }
}

// --- 数据聚合器：计算 CPU 使用率和网络速率 ---
class StatusDataAggregator {
  private cpuStats = new Map<string, { total: number; idle: number; timestamp: number }>();
  private netStats = new Map<string, { rx: number; tx: number; timestamp: number }>();

  /** 计算 CPU 使用率 */
  calculateCpuPercent(
    sessionId: string,
    currentCpuTimes: { total: number; idle: number }
  ): number | undefined {
    const now = Date.now();
    const prev = this.cpuStats.get(sessionId);
    if (prev && prev.timestamp < now) {
      const totalDiff = currentCpuTimes.total - prev.total;
      const idleDiff = currentCpuTimes.idle - prev.idle;
      const timeDiffMs = now - prev.timestamp;
      if (totalDiff > 0 && timeDiffMs > 100) {
        const usageRatio = 1.0 - idleDiff / totalDiff;
        this.cpuStats.set(sessionId, { ...currentCpuTimes, timestamp: now });
        return parseFloat(Math.max(0, Math.min(100, usageRatio * 100)).toFixed(1));
      }
    }
    this.cpuStats.set(sessionId, { ...currentCpuTimes, timestamp: now });
    if (!prev?.total) return 0;
    return prev.total > 0 ? 0 : undefined;
  }

  /** 计算网络速率 */
  calculateNetRates(
    sessionId: string,
    timestamp: number,
    currentRx: number,
    currentTx: number
  ): { netRxRate: number; netTxRate: number } {
    const prev = this.netStats.get(sessionId);
    let netRxRate = 0;
    let netTxRate = 0;
    if (prev && prev.timestamp < timestamp) {
      const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
      if (timeDiffSeconds > 0.1) {
        netRxRate = Math.max(0, Math.round((currentRx - prev.rx) / timeDiffSeconds));
        netTxRate = Math.max(0, Math.round((currentTx - prev.tx) / timeDiffSeconds));
      }
    }
    this.netStats.set(sessionId, { rx: currentRx, tx: currentTx, timestamp });
    return { netRxRate, netTxRate };
  }

  /** 清理会话缓存 */
  cleanup(sessionId: string): void {
    this.cpuStats.delete(sessionId);
    this.netStats.delete(sessionId);
  }
}

export class StatusMonitorService {
  private clientStates: Map<string, ClientState>;
  private healthCollector = new HealthCheckCollector();
  private dataAggregator = new StatusDataAggregator();

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
  }

  async startStatusPolling(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sshClient || state.statusIntervalId) return;

    let intervalMs: number;
    try {
      const intervalSeconds = await settingsService.getStatusMonitorIntervalSeconds();
      intervalMs = intervalSeconds * 1000;
      console.info(
        `[StatusMonitor ${sessionId}] 使用配置的轮询间隔: ${intervalSeconds} 秒 (${intervalMs}ms)`
      );
    } catch (error: unknown) {
      console.error(
        `[StatusMonitor ${sessionId}] 获取轮询间隔设置失败，将使用默认值 3000ms:`,
        error
      );
      intervalMs = 3000;
    }

    state.statusIntervalId = setInterval(() => {
      this.fetchAndSendServerStatus(sessionId);
    }, intervalMs);
  }

  stopStatusPolling(sessionId: string): void {
    const state = this.clientStates.get(sessionId);
    if (state?.statusIntervalId) {
      clearInterval(state.statusIntervalId);
      state.statusIntervalId = undefined;
      this.dataAggregator.cleanup(sessionId);
    }
  }

  private async fetchAndSendServerStatus(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sshClient || state.ws.readyState !== WebSocket.OPEN) {
      this.stopStatusPolling(sessionId);
      return;
    }
    try {
      const status = await this.fetchServerStatus(state.sshClient, sessionId);
      state.ws.send(
        JSON.stringify({
          type: 'status_update',
          payload: { connectionId: state.dbConnectionId, status },
        })
      );
    } catch (error: unknown) {
      state.ws.send(
        JSON.stringify({
          type: 'status:error',
          payload: {
            connectionId: state.dbConnectionId,
            message: `获取状态失败: ${getErrorMessage(error)}`,
          },
        })
      );
    }
  }

  private async fetchServerStatus(sshClient: Client, sessionId: string): Promise<ServerStatus> {
    const timestamp = Date.now();
    const status: Partial<ServerStatus> = { timestamp };
    const collector = this.healthCollector;

    // 并行采集不依赖 CPU 状态的指标
    const [osName, cpuModel, memStats, diskStats, loadAvg, netDevStats] = await Promise.allSettled([
      collector.collectOsName(sshClient),
      collector.collectCpuModel(sshClient),
      collector.collectMemoryStats(sshClient),
      collector.collectDiskStats(sshClient),
      collector.collectLoadAvg(sshClient),
      collector.parseProcNetDev(sshClient),
    ]);

    if (osName.status === 'fulfilled') status.osName = osName.value;
    if (cpuModel.status === 'fulfilled') status.cpuModel = cpuModel.value;
    if (memStats.status === 'fulfilled') Object.assign(status, memStats.value);
    if (diskStats.status === 'fulfilled') Object.assign(status, diskStats.value);
    if (loadAvg.status === 'fulfilled') status.loadAvg = loadAvg.value;

    // CPU 使用率（需要历史数据，单独处理）
    try {
      const procStatOutput = await collector.executeSshCommand(sshClient, 'cat /proc/stat');
      const cpuTimes = collector.parseProcStat(procStatOutput);
      if (cpuTimes) {
        status.cpuPercent = this.dataAggregator.calculateCpuPercent(sessionId, cpuTimes);
      }
    } catch {
      status.cpuPercent = undefined;
    }

    // 网络速率
    if (netDevStats.status === 'fulfilled' && netDevStats.value) {
      try {
        const defaultIface =
          (await collector.getDefaultInterface(sshClient)) ||
          Object.keys(netDevStats.value).find((iface) => iface !== 'lo');
        if (defaultIface && netDevStats.value[defaultIface]) {
          status.netInterface = defaultIface;
          const { rx_bytes, tx_bytes } = netDevStats.value[defaultIface];
          const rates = this.dataAggregator.calculateNetRates(
            sessionId,
            timestamp,
            rx_bytes,
            tx_bytes
          );
          status.netRxRate = rates.netRxRate;
          status.netTxRate = rates.netTxRate;
        }
      } catch {
        /* 静默处理 */
      }
    }

    return status as ServerStatus;
  }
}
