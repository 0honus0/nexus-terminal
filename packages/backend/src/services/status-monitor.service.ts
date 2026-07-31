import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState } from '../websocket';
import { settingsService } from '../settings/settings.service';

interface ServerStatus {
    cpuPercent?: number;
    memPercent?: number;
    memUsed?: number;
    memTotal?: number;
    swapPercent?: number;
    swapUsed?: number;
    swapTotal?: number;
    diskPercent?: number;
    diskUsed?: number;
    diskTotal?: number;
    cpuModel?: string;
    netRxRate?: number;
    netTxRate?: number;
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

interface StaticStatusInfo {
    osName: string;
    cpuModel: string;
    netInterface?: string;
}

const previousNetStats = new Map<string, { rx: number; tx: number; timestamp: number }>();

const SECTION_PREFIX = '__NEXUS_STATUS_';
const SECTION_NAMES = [
    'OS_RELEASE',
    'CPU_MODEL',
    'MEMINFO',
    'DISK',
    'PROC_STAT',
    'LOADAVG',
    'NET_ROUTE',
    'NET_DEV',
] as const;

type SectionName = typeof SECTION_NAMES[number];

export class StatusMonitorService {
    private previousCpuStats = new Map<string, { total: number; idle: number; timestamp: number; lastPercent: number }>();
    private staticInfo = new Map<string, StaticStatusInfo>();
    private fetchInFlight = new Set<string>();
    private subscribedSessions = new Set<string>();
    private startInFlight = new Set<string>();
    private bootstrapSamplePending = new Set<string>();
    private bootstrapTimers = new Map<string, NodeJS.Timeout>();

    constructor(private readonly clientStates: Map<string, ClientState>) {}

    async startStatusPolling(sessionId: string): Promise<void> {
        this.subscribedSessions.add(sessionId);
        const initialState = this.clientStates.get(sessionId);
        if (!initialState?.sshClient || initialState.statusIntervalId || this.startInFlight.has(sessionId)) return;

        this.startInFlight.add(sessionId);
        try {
            let intervalMs = 3000;
            try {
                intervalMs = Math.max(1000, (await settingsService.getStatusMonitorIntervalSeconds()) * 1000);
            } catch (error) {
                console.error(`[StatusMonitor ${sessionId}] 获取轮询间隔设置失败，使用默认值 3000ms:`, error);
            }

            const state = this.clientStates.get(sessionId);
            if (!this.subscribedSessions.has(sessionId) || !state?.sshClient || state.statusIntervalId) return;

            this.bootstrapSamplePending.add(sessionId);
            state.statusIntervalId = setInterval(() => {
                void this.fetchAndSendServerStatus(sessionId);
            }, intervalMs);
            void this.fetchAndSendServerStatus(sessionId);
        } finally {
            this.startInFlight.delete(sessionId);
        }
    }

    stopStatusPolling(sessionId: string): void {
        this.subscribedSessions.delete(sessionId);
        const state = this.clientStates.get(sessionId);
        if (state?.statusIntervalId) {
            clearInterval(state.statusIntervalId);
            state.statusIntervalId = undefined;
        }

        const bootstrapTimer = this.bootstrapTimers.get(sessionId);
        if (bootstrapTimer) clearTimeout(bootstrapTimer);
        this.bootstrapTimers.delete(sessionId);
        this.bootstrapSamplePending.delete(sessionId);
        previousNetStats.delete(sessionId);
        this.previousCpuStats.delete(sessionId);
    }

    clearSession(sessionId: string): void {
        this.stopStatusPolling(sessionId);
        this.startInFlight.delete(sessionId);
        this.staticInfo.delete(sessionId);
    }

    private async fetchAndSendServerStatus(sessionId: string): Promise<void> {
        if (this.fetchInFlight.has(sessionId)) return;

        const state = this.clientStates.get(sessionId);
        if (!state?.sshClient || state.ws.readyState !== WebSocket.OPEN) {
            this.stopStatusPolling(sessionId);
            return;
        }

        this.fetchInFlight.add(sessionId);
        try {
            const status = await this.fetchServerStatus(state.sshClient, sessionId);
            if (state.ws.readyState === WebSocket.OPEN && state.statusIntervalId) {
                state.ws.send(JSON.stringify({
                    type: 'status_update',
                    payload: { connectionId: state.dbConnectionId, status },
                }));
            }

            if (this.bootstrapSamplePending.delete(sessionId) && state.statusIntervalId) {
                const timer = setTimeout(() => {
                    this.bootstrapTimers.delete(sessionId);
                    void this.fetchAndSendServerStatus(sessionId);
                }, 500);
                this.bootstrapTimers.set(sessionId, timer);
            }
        } catch (error) {
            if (state.ws.readyState === WebSocket.OPEN && state.statusIntervalId) {
                const message = error instanceof Error ? error.message : String(error);
                state.ws.send(JSON.stringify({
                    type: 'status:error',
                    payload: { connectionId: state.dbConnectionId, message: `获取状态失败: ${message}` },
                }));
            }
        } finally {
            this.fetchInFlight.delete(sessionId);
        }
    }

    private async fetchServerStatus(sshClient: Client, sessionId: string): Promise<ServerStatus> {
        const timestamp = Date.now();
        const includeStatic = !this.staticInfo.has(sessionId);
        const output = await this.executeSshCommand(sshClient, this.buildCombinedStatusCommand(includeStatic));
        const sections = this.parseSections(output);

        let staticInfo = this.staticInfo.get(sessionId);
        if (!staticInfo) {
            const netStats = this.parseProcNetDev(sections.get('NET_DEV') ?? '');
            staticInfo = {
                osName: this.parseOsName(sections.get('OS_RELEASE') ?? ''),
                cpuModel: (sections.get('CPU_MODEL') ?? '').trim() || 'Unknown',
                netInterface: this.parseDefaultInterface(sections.get('NET_ROUTE') ?? '', netStats),
            };
            this.staticInfo.set(sessionId, staticInfo);
        }

        const status: ServerStatus = {
            timestamp,
            osName: staticInfo.osName,
            cpuModel: staticInfo.cpuModel,
            netInterface: staticInfo.netInterface,
        };

        const meminfo = sections.get('MEMINFO');
        if (meminfo) Object.assign(status, this.parseProcMeminfo(meminfo));

        const disk = sections.get('DISK');
        if (disk) Object.assign(status, this.parseDiskUsage(disk));

        const cpuTimes = this.parseProcStat(sections.get('PROC_STAT') ?? '');
        if (cpuTimes) {
            const previous = this.previousCpuStats.get(sessionId);
            let cpuPercent = previous?.lastPercent ?? 0;
            if (previous && previous.timestamp < timestamp) {
                const totalDiff = cpuTimes.total - previous.total;
                const idleDiff = cpuTimes.idle - previous.idle;
                if (totalDiff > 0 && idleDiff >= 0) {
                    cpuPercent = Number((Math.max(0, Math.min(1, 1 - Math.min(idleDiff, totalDiff) / totalDiff)) * 100).toFixed(1));
                }
            }
            status.cpuPercent = cpuPercent;
            this.previousCpuStats.set(sessionId, { ...cpuTimes, timestamp, lastPercent: cpuPercent });
        }

        const loadFields = (sections.get('LOADAVG') ?? '').trim().split(/\s+/).slice(0, 3).map(Number);
        if (loadFields.length === 3 && loadFields.every(Number.isFinite)) status.loadAvg = loadFields;

        const netStats = this.parseProcNetDev(sections.get('NET_DEV') ?? '');
        let netInterface = staticInfo.netInterface;
        if (!netInterface || !netStats[netInterface]) {
            netInterface = Object.keys(netStats).find(name => name !== 'lo');
            staticInfo.netInterface = netInterface;
            status.netInterface = netInterface;
        }
        if (netInterface && netStats[netInterface]) {
            const current = netStats[netInterface];
            const previous = previousNetStats.get(sessionId);
            if (previous && previous.timestamp < timestamp) {
                const elapsedSeconds = (timestamp - previous.timestamp) / 1000;
                status.netRxRate = elapsedSeconds > 0
                    ? Math.max(0, Math.round((current.rx_bytes - previous.rx) / elapsedSeconds))
                    : 0;
                status.netTxRate = elapsedSeconds > 0
                    ? Math.max(0, Math.round((current.tx_bytes - previous.tx) / elapsedSeconds))
                    : 0;
            } else {
                status.netRxRate = 0;
                status.netTxRate = 0;
            }
            previousNetStats.set(sessionId, { rx: current.rx_bytes, tx: current.tx_bytes, timestamp });
        }

        return status;
    }

    private buildCombinedStatusCommand(includeStatic: boolean): string {
        const marker = (name: SectionName): string => `printf '\\n${SECTION_PREFIX}${name}__\\n';`;
        const commands: string[] = ['export LC_ALL=C;'];

        if (includeStatic) {
            commands.push(
                marker('OS_RELEASE'),
                'cat /etc/os-release 2>/dev/null || true;',
                marker('CPU_MODEL'),
                "awk -F: '/model name|Hardware|Processor/{value=$2; sub(/^[[:space:]]+/, \"\", value); if (value != \"\") { print value; exit }}' /proc/cpuinfo 2>/dev/null || true;",
                marker('NET_ROUTE'),
                'cat /proc/net/route 2>/dev/null || true;',
            );
        }

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

    private parseSections(output: string): Map<SectionName, string> {
        const sections = new Map<SectionName, string>();
        let current: SectionName | null = null;
        const linesBySection = new Map<SectionName, string[]>();

        for (const line of output.replace(/\r/g, '').split('\n')) {
            const match = line.match(/^__NEXUS_STATUS_([A-Z_]+)__$/);
            if (match && SECTION_NAMES.includes(match[1] as SectionName)) {
                current = match[1] as SectionName;
                if (!linesBySection.has(current)) linesBySection.set(current, []);
                continue;
            }
            if (current) linesBySection.get(current)?.push(line);
        }

        linesBySection.forEach((lines, name) => sections.set(name, lines.join('\n').trim()));
        return sections;
    }

    private parseOsName(output: string): string {
        return output.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1]
            ?? output.match(/^NAME="?([^"\n]+)"?/m)?.[1]
            ?? 'Unknown';
    }

    private parseDefaultInterface(routeOutput: string, netStats: NetworkStats): string | undefined {
        for (const line of routeOutput.split('\n').slice(1)) {
            const fields = line.trim().split(/\s+/);
            if (fields.length >= 4 && fields[1] === '00000000') return fields[0];
        }
        return Object.keys(netStats).find(name => name !== 'lo');
    }

    private parseProcNetDev(output: string): NetworkStats {
        const stats: NetworkStats = {};
        for (const line of output.split('\n').slice(2)) {
            const separator = line.indexOf(':');
            if (separator < 0) continue;
            const interfaceName = line.slice(0, separator).trim();
            const fields = line.slice(separator + 1).trim().split(/\s+/).map(Number);
            if (!interfaceName || fields.length < 9 || !Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;
            stats[interfaceName] = { rx_bytes: fields[0], tx_bytes: fields[8] };
        }
        return stats;
    }

    private parseDiskUsage(output: string): Pick<ServerStatus, 'diskTotal' | 'diskUsed' | 'diskPercent'> {
        const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
        const dataLine = lines.slice(1).find(line => line.endsWith(' /')) ?? (lines.length > 0 ? lines[lines.length - 1] : '');
        const fields = dataLine.split(/\s+/);
        const percentField = fields.find((field: string) => /^\d+%$/.test(field));
        const total = Number(fields[1]);
        const used = Number(fields[2]);
        const percent = percentField ? Number(percentField.slice(0, -1)) : Number.NaN;
        return {
            diskTotal: Number.isFinite(total) ? total : undefined,
            diskUsed: Number.isFinite(used) ? used : undefined,
            diskPercent: Number.isFinite(percent) ? percent : undefined,
        };
    }

    private executeSshCommand(sshClient: Client, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            sshClient.exec(command, (error, stream) => {
                if (error) return reject(error);
                stream.on('data', (data: Buffer) => { stdout += data.toString('utf8'); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf8'); });
                stream.on('error', reject);
                stream.on('close', (code?: number) => {
                    if (code && code !== 0 && !stdout) reject(new Error(stderr.trim() || `状态命令退出码 ${code}`));
                    else resolve(stdout);
                });
            });
        });
    }

    private parseProcMeminfo(output: string): Pick<ServerStatus, 'memTotal' | 'memUsed' | 'memPercent' | 'swapTotal' | 'swapUsed' | 'swapPercent'> {
        const values = new Map<string, number>();
        for (const line of output.split('\n')) {
            const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/);
            if (match) values.set(match[1], Number(match[2]));
        }

        const totalKb = values.get('MemTotal');
        if (!totalKb || totalKb <= 0) throw new Error('/proc/meminfo 中缺少有效的 MemTotal');

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
            memPercent: Number(((usedKb / totalKb) * 100).toFixed(1)),
            swapTotal: Math.round(swapTotalKb / 1024),
            swapUsed: Math.round(swapUsedKb / 1024),
            swapPercent: swapTotalKb > 0 ? Number(((swapUsedKb / swapTotalKb) * 100).toFixed(1)) : 0,
        };
    }

    private parseProcStat(output: string): { total: number; idle: number } | null {
        const cpuLine = output.split('\n').find(line => line.startsWith('cpu '));
        if (!cpuLine) return null;
        const fields = cpuLine.trim().split(/\s+/).slice(1).map(Number);
        if (fields.length < 4 || fields.slice(0, 4).some(value => !Number.isFinite(value))) return null;
        const idle = fields[3] + (Number.isFinite(fields[4]) ? fields[4] : 0);
        const total = fields.slice(0, 8).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
        return Number.isFinite(total) && Number.isFinite(idle) ? { total, idle } : null;
    }
}
