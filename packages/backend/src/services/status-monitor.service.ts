import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState } from '../websocket';
import { settingsService } from '../settings/settings.service';


interface ServerStatus {
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
    loadAvg?: number[]; // 系统平均负载 [1min, 5min, 15min]
    timestamp: number; // 状态获取时间戳
}


interface NetworkStats {
    [interfaceName: string]: {
        rx_bytes: number;
        tx_bytes: number;
    }
}


// 用于存储上一次的网络统计信息以计算速率
const previousNetStats = new Map<string, { rx: number, tx: number, timestamp: number }>();

export class StatusMonitorService {
    private clientStates: Map<string, ClientState>; // 使用导入的 ClientState
    // 用于存储上一次的 CPU 统计信息以计算使用率
    private previousCpuStats = new Map<string, { total: number, idle: number, timestamp: number, lastPercent: number }>();
    private fetchInFlight = new Set<string>();
    private bootstrapSamplePending = new Set<string>();
    private bootstrapTimers = new Map<string, NodeJS.Timeout>();

    constructor(clientStates: Map<string, ClientState>) {
        this.clientStates = clientStates;
    }

    /**
     * 启动指定会话的状态轮询
     * @param sessionId 会话 ID
     */
    async startStatusPolling(sessionId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient) {
            return;
        }
        if (state.statusIntervalId) {
             return;
         }

         // +++ 从 settingsService 获取轮询间隔 +++
         let intervalMs: number;
         try {
             const intervalSeconds = await settingsService.getStatusMonitorIntervalSeconds();
             intervalMs = intervalSeconds * 1000;
             console.log(`[StatusMonitor ${sessionId}] 使用配置的轮询间隔: ${intervalSeconds} 秒 (${intervalMs}ms)`);
         } catch (error) {
             console.error(`[StatusMonitor ${sessionId}] 获取轮询间隔设置失败，将使用默认值 3000ms:`, error);
             intervalMs = 3000; // 出错时回退到 3 秒
         }

         this.bootstrapSamplePending.add(sessionId);
         void this.fetchAndSendServerStatus(sessionId);
         state.statusIntervalId = setInterval(() => {
             void this.fetchAndSendServerStatus(sessionId);
         }, intervalMs); // --- 使用获取到的间隔 ---
    }

    /**
     * 停止指定会话的状态轮询
     * @param sessionId 会话 ID
     */
    stopStatusPolling(sessionId: string): void {
        const state = this.clientStates.get(sessionId);
        if (state?.statusIntervalId) {
            //console.warn(`[StatusMonitor] 停止会话 ${sessionId} 的状态轮询。`);
            clearInterval(state.statusIntervalId);
            state.statusIntervalId = undefined;
            previousNetStats.delete(sessionId); // 清理网络统计缓存
            this.previousCpuStats.delete(sessionId); // 清理 CPU 统计缓存
        }
        const bootstrapTimer = this.bootstrapTimers.get(sessionId);
        if (bootstrapTimer) clearTimeout(bootstrapTimer);
        this.bootstrapTimers.delete(sessionId);
        this.bootstrapSamplePending.delete(sessionId);
        this.fetchInFlight.delete(sessionId);
    }

    /**
     * 获取并发送服务器状态给客户端
     * @param sessionId 会话 ID
     */
    private async fetchAndSendServerStatus(sessionId: string): Promise<void> {
        if (this.fetchInFlight.has(sessionId)) {
            return;
        }
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient || state.ws.readyState !== WebSocket.OPEN) {
            //console.warn(`[StatusMonitor] 无法获取会话 ${sessionId} 的状态，停止轮询。原因：状态无效、SSH断开或WS关闭。`);
            this.stopStatusPolling(sessionId);
            return;
        }
        this.fetchInFlight.add(sessionId);
        try {
            // 传递 sessionId 给 fetchServerStatus 以便查找 previousNetStats
            const status = await this.fetchServerStatus(state.sshClient, sessionId);
            if (state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'status_update', payload: { connectionId: state.dbConnectionId, status } }));
            }

            if (this.bootstrapSamplePending.delete(sessionId)) {
                const timer = setTimeout(() => {
                    this.bootstrapTimers.delete(sessionId);
                    void this.fetchAndSendServerStatus(sessionId);
                }, 500);
                this.bootstrapTimers.set(sessionId, timer);
            }
        } catch (error: any) {
            // --- 移除 console.warn ---
            // console.warn(`[StatusMonitor] 获取会话 ${sessionId} 服务器状态失败:`, error);
            if (state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'status:error', payload: { connectionId: state.dbConnectionId, message: `获取状态失败: ${error.message}` } }));
            }
        } finally {
            this.fetchInFlight.delete(sessionId);
        }
    }

     /**
      * 通过 SSH 执行命令获取服务器状态信息
      * @param sshClient SSH 客户端实例
      * @param sessionId 当前会话 ID，用于网络速率计算
      * @returns Promise<ServerStatus> 服务器状态信息
      */
     private async fetchServerStatus(sshClient: Client, sessionId: string): Promise<ServerStatus> {
        //  console.debug(`[StatusMonitor ${sessionId}] Fetching server status...`);
         const timestamp = Date.now();
         let status: Partial<ServerStatus> = { timestamp };

         try {
             // --- OS Name ---
             try {
                 const osReleaseOutput = await this.executeSshCommand(sshClient, 'cat /etc/os-release');
                 const nameMatch = osReleaseOutput.match(/^PRETTY_NAME="?([^"]+)"?/m);
                 status.osName = nameMatch ? nameMatch[1] : (osReleaseOutput.match(/^NAME="?([^"]+)"?/m)?.[1] ?? 'Unknown');
             } catch (err) { }

             try {
                 let cpuModelOutput = '';
                 try {
                     cpuModelOutput = await this.executeSshCommand(sshClient, "cat /proc/cpuinfo | grep 'model name' | head -n 1");
                     status.cpuModel = cpuModelOutput.match(/model name\s*:\s*(.*)/i)?.[1].trim();
                 } catch (procErr) {

                     try {
                         cpuModelOutput = await this.executeSshCommand(sshClient, "lscpu | grep 'Model name:'");
                         status.cpuModel = cpuModelOutput.match(/Model name:\s+(.*)/)?.[1].trim();
                     } catch (lscpuErr) {

                     }
                 }
                 if (!status.cpuModel) {
                     status.cpuModel = 'Unknown';
                 }
             } catch (err) {

                 status.cpuModel = 'Unknown';
             }


             try {
                 const meminfoOutput = await this.executeSshCommand(sshClient, 'cat /proc/meminfo');
                 Object.assign(status, this.parseProcMeminfo(meminfoOutput));
             } catch (err) { /* 静默处理 */ }


             try {
                 let dfCommand = "df -kP /"; // 优先尝试 POSIX 标准格式
                 let dfOutput: string;
                 try {
                     dfOutput = await this.executeSshCommand(sshClient, dfCommand);
                 } catch (errP) {
                     dfCommand = "df -k /"; // 备用方案
                     try {
                        dfOutput = await this.executeSshCommand(sshClient, dfCommand);
                     } catch (errK) {
                        dfOutput = "";
                     }
                 }

                 if (dfOutput) {
                     const lines = dfOutput.split('\n');
                     let parsedDiskInfo = false;
                     // 从第二行开始查找根挂载点信息 (跳过表头)
                     for (let i = 1; i < lines.length; i++) {
                         const line = lines[i].trim();
                         // 确保是根挂载点，通常以 " /" 结尾
                         if (line.endsWith(" /")) {
                             const parts = line.split(/\s+/);
                             // 预期 parts 至少包含: 文件系统, 总量(KB), 已用(KB), 可用(KB), 百分比%, 挂载点
                             // 例如: /dev/sda1 10307920 3841884 5941800 40% /
                             if (parts.length >= 5) {
                                 const total = parseInt(parts[1], 10);
                                 const used = parseInt(parts[2], 10);
                                 const percentStr = parts.find(p => p.endsWith('%')); // 查找百分比字符串

                                 if (percentStr) {
                                     const percentMatch = percentStr.match(/(\d+)%/);
                                     if (!isNaN(total) && !isNaN(used) && percentMatch && percentMatch[1]) {
                                         status.diskTotal = total; // KB
                                         status.diskUsed = used;   // KB
                                         status.diskPercent = parseFloat(percentMatch[1]);
                                         parsedDiskInfo = true;
                                         break;
                                     }
                                 }
                             }
                         }
                     }

                 }
             } catch (err) {
                 // 如果捕获到错误 (例如 executeSshCommand 内部的 Promise reject), disk* 字段将保持 undefined
             }

            try {
                const procStatOutput = await this.executeSshCommand(sshClient, 'cat /proc/stat');
                const currentCpuTimes = this.parseProcStat(procStatOutput);
                const now = Date.now(); // Use a consistent timestamp

                if (currentCpuTimes) {
                    const prevCpuStats = this.previousCpuStats.get(sessionId);

                    if (prevCpuStats && prevCpuStats.timestamp < now) {
                        const totalDiff = currentCpuTimes.total - prevCpuStats.total;
                        const idleDiff = currentCpuTimes.idle - prevCpuStats.idle;
                        const timeDiffMs = now - prevCpuStats.timestamp; // Time difference in ms
                        let nextPercent = prevCpuStats.lastPercent;

                        // Ensure positive difference and minimal time gap (e.g., > 100ms) to avoid division by zero or erratic results
                        if (totalDiff < 0 || idleDiff < 0) {
                            // CPU counters can reset after reboot; keep the last value and use this sample as a new baseline.
                            nextPercent = prevCpuStats.lastPercent;
                        } else if (totalDiff > 0 && timeDiffMs > 100) {
                            const safeIdleDiff = Math.min(idleDiff, totalDiff);
                            const usageRatio = 1.0 - (safeIdleDiff / totalDiff);
                            // Clamp value between 0 and 100, format to 1 decimal place
                            nextPercent = parseFloat((Math.max(0, Math.min(100, usageRatio * 100))).toFixed(1));
                        }
                        status.cpuPercent = nextPercent;
                        this.previousCpuStats.set(sessionId, { ...currentCpuTimes, timestamp: now, lastPercent: nextPercent });
                    } else {
                        // First run or timestamp issue, report 0 as we can't calculate a rate
                        status.cpuPercent = 0;
                        this.previousCpuStats.set(sessionId, { ...currentCpuTimes, timestamp: now, lastPercent: 0 });
                    }
                } else {
                    // Failed to parse /proc/stat, set to undefined or keep previous? Let's use undefined.
                    status.cpuPercent = undefined;
                }
            } catch (err) {
                // Failed to execute cat /proc/stat
                status.cpuPercent = undefined;
                // console.warn(`[StatusMonitor ${sessionId}] Failed to get CPU stats via /proc/stat:`, err);
            }

            try {
                const uptimeOutput = await this.executeSshCommand(sshClient, 'uptime');
                 const match = uptimeOutput.match(/load average(?:s)?:\s*([\d.]+)[, ]?\s*([\d.]+)[, ]?\s*([\d.]+)/);
                 if (match) status.loadAvg = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
             } catch (err) { /* 静默处理 */ }


             try {
                 const currentStats = await this.parseProcNetDev(sshClient);
                 if (currentStats) {
                     const defaultInterface = await this.getDefaultInterface(sshClient) || Object.keys(currentStats).find(iface => iface !== 'lo'); // Detect or fallback excluding loopback

                     if (defaultInterface && currentStats[defaultInterface]) {
                         status.netInterface = defaultInterface;
                         const currentRx = currentStats[defaultInterface].rx_bytes;
                         const currentTx = currentStats[defaultInterface].tx_bytes;
                         const prevStats = previousNetStats.get(sessionId);

                         if (prevStats && prevStats.timestamp < timestamp) {
                             const timeDiffSeconds = (timestamp - prevStats.timestamp) / 1000;
                             if (timeDiffSeconds > 0.1) {
                                 status.netRxRate = Math.max(0, Math.round((currentRx - prevStats.rx) / timeDiffSeconds));
                                 status.netTxRate = Math.max(0, Math.round((currentTx - prevStats.tx) / timeDiffSeconds));
                             } else { status.netRxRate = 0; status.netTxRate = 0; }
                         } else { status.netRxRate = 0; status.netTxRate = 0; }

                         previousNetStats.set(sessionId, { rx: currentRx, tx: currentTx, timestamp });
                     } else { /* 静默处理 */ }
                 }
             } catch (err) { /* 静默处理 */ }

         } catch (error) {
             console.error(`[StatusMonitor ${sessionId}] General error fetching server status:`, error);
         }

         return status as ServerStatus;
     }

    /**
     * 解析 /proc/net/dev 的输出
     * @param sshClient SSH 客户端实例
     * @returns Promise<NetworkStats | null> 解析后的网络统计信息或 null
     */
    private async parseProcNetDev(sshClient: Client): Promise<NetworkStats | null> {
        let output: string;
        try {
            // 将命令执行放入 try...catch
            output = await this.executeSshCommand(sshClient, 'cat /proc/net/dev');
        } catch (error) {
            // 如果命令失败，记录警告并返回 null

            return null;
        }
        // 如果命令成功，继续解析
        try {
            const lines = output.split('\n').slice(2); // Skip header lines
            const stats: NetworkStats = {};
            for (const line of lines) {
                const parts = line.trim().split(/:\s+|\s+/);
                if (parts.length < 17) continue;
                const interfaceName = parts[0];
                const rx_bytes = parseInt(parts[1], 10);
                const tx_bytes = parseInt(parts[9], 10);
                if (!isNaN(rx_bytes) && !isNaN(tx_bytes)) {
                    stats[interfaceName] = { rx_bytes, tx_bytes };
                }
            }
            return Object.keys(stats).length > 0 ? stats : null;
        } catch (parseError) {
            return null;
        }
    }

    /**
     * 获取默认网络接口名称 (Linux specific)
     * @param sshClient SSH 客户端实例
     * @returns Promise<string | null> 默认接口名称或 null
     */
    private async getDefaultInterface(sshClient: Client): Promise<string | null> {
        try {
            // 使用 ip route 命令查找默认路由对应的接口
            const output = await this.executeSshCommand(sshClient, "ip route get 1.1.1.1 | grep -oP 'dev\\s+\\K\\S+'");
            const interfaceName = output.trim();
            if (interfaceName) return interfaceName;
            // 如果 ip route 没返回有效接口名，也尝试 fallback


        } catch (error) {

        try {
             const netDevOutput = await this.executeSshCommand(sshClient, 'cat /proc/net/dev');
             const lines = netDevOutput.split('\n').slice(2);
             for (const line of lines) {
                     const iface = line.trim().split(':')[0];
                     if (iface && iface !== 'lo') {
                         return iface;
                     }
                 }
            } catch (fallbackError) {

            }

            return null;
        }

        return null;
    }

    /**
     * 在 SSH 连接上执行单个命令
     * @param sshClient SSH 客户端实例
     * @param command 要执行的命令
     * @returns Promise<string> 命令的标准输出
     * @throws Error 如果命令执行失败
     */
    private executeSshCommand(sshClient: Client, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            sshClient.exec(command, (err, stream) => {
                if (err) {
                    return reject(new Error(`执行命令 '${command}' 失败: ${err.message}`));
                }
                stream.on('close', (code: number, signal?: string) => {
                    resolve(output.trim());
                }).on('data', (data: Buffer) => {
                    output += data.toString('utf8');
                }).stderr.on('data', (data: Buffer) => {
                });
            });
        });
    }

     /**
      * 查找与给定 SSH 客户端关联的会话 ID (辅助函数)
      * @param sshClientToFind 要查找的 SSH 客户端实例
      * @returns string | undefined 找到的会话 ID 或 undefined
      */
    private findSessionIdForClient(sshClientToFind: Client): string | undefined {
         for (const [sessionId, state] of this.clientStates.entries()) {
             if (state.sshClient === sshClientToFind) {
                 return sessionId;
             }
         }
         return undefined;
     }

    /**
     * Parse Linux memory counters directly so locale and the installed `free`
     * implementation cannot change units or column meanings.
     */
    private parseProcMeminfo(output: string): Pick<ServerStatus, 'memTotal' | 'memUsed' | 'memPercent' | 'swapTotal' | 'swapUsed' | 'swapPercent'> {
        const values = new Map<string, number>();
        for (const line of output.split('\n')) {
            const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/);
            if (match) values.set(match[1], Number(match[2]));
        }

        const totalKb = values.get('MemTotal');
        if (!totalKb || totalKb <= 0) {
            throw new Error('/proc/meminfo 中缺少有效的 MemTotal');
        }

        const fallbackAvailableKb =
            (values.get('MemFree') ?? 0)
            + (values.get('Buffers') ?? 0)
            + (values.get('Cached') ?? 0)
            + (values.get('SReclaimable') ?? 0)
            - (values.get('Shmem') ?? 0);
        const availableKb = Math.max(0, Math.min(totalKb, values.get('MemAvailable') ?? fallbackAvailableKb));
        const usedKb = totalKb - availableKb;
        const swapTotalKb = values.get('SwapTotal') ?? 0;
        const swapFreeKb = Math.max(0, Math.min(swapTotalKb, values.get('SwapFree') ?? 0));
        const swapUsedKb = swapTotalKb - swapFreeKb;

        return {
            memTotal: Math.round(totalKb / 1024),
            memUsed: Math.round(usedKb / 1024),
            memPercent: parseFloat(((usedKb / totalKb) * 100).toFixed(1)),
            swapTotal: Math.round(swapTotalKb / 1024),
            swapUsed: Math.round(swapUsedKb / 1024),
            swapPercent: swapTotalKb > 0 ? parseFloat(((swapUsedKb / swapTotalKb) * 100).toFixed(1)) : 0,
        };
    }

    /**
     * Parses the output of /proc/stat to get total and idle CPU times.
     * @param output The string output from `cat /proc/stat`.
     * @returns An object with total and idle times, or null if parsing fails.
     */
    private parseProcStat(output: string): { total: number, idle: number } | null {
        try {
            const lines = output.split('\n');
            // Find the line starting with "cpu " (aggregate of all cores)
            const cpuLine = lines.find(line => line.startsWith('cpu '));
            if (!cpuLine) {
                // console.warn("Could not find 'cpu ' line in /proc/stat");
                return null;
            }

            // Fields documented in `man proc`: cpu user nice system idle iowait irq softirq steal guest guest_nice
            // We need to handle potential missing fields at the end (guest times are not always present)
            const fieldsStr = cpuLine.trim().split(/\s+/).slice(1); // Remove 'cpu' prefix
            const fields = fieldsStr.map(Number); // Convert remaining fields to numbers

            // We need at least the first 4 fields (user, nice, system, idle)
            if (fields.length < 4 || fields.slice(0, 4).some(isNaN)) {
                // console.warn("Invalid format or missing required fields in 'cpu ' line:", cpuLine);
                return null;
            }

            // Linux reports iowait separately, but tools such as btop treat it as idle.
            const idle = fields[3] + (Number.isNaN(fields[4]) ? 0 : (fields[4] ?? 0));

            // guest/guest_nice are already included in user/nice, so only sum
            // user..steal (the first eight counters) to avoid double counting.
            const total = fields.slice(0, 8).reduce((sum, value) => sum + (isNaN(value) ? 0 : value), 0);

            // Final check for NaN just to be safe
            if (isNaN(total) || isNaN(idle)) {
                // console.warn("NaN detected after parsing /proc/stat fields:", fields);
                return null;
            }

            return { total, idle };
        } catch (e) {
            // console.error("Error parsing /proc/stat:", e);
            return null;
        }
    }
}
