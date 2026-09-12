import { logger, onBackendLogLevelChange } from '../shared/logging/logger';
import { runtimePerformanceMetrics } from '../shared/observability/runtime-performance';

const DEFAULT_REPORT_INTERVAL_MS = 5_000;

export interface WebSocketPerformanceSnapshot {
  total: number;
  workspace: number;
  upload: number;
  remoteDesktop: number;
  agent: number;
  agentTerminal: number;
  agentSubscriptions: number;
  agentMaxReplayLag: number;
  agentProtocolErrors: number;
  agentSlowConsumerCloses: number;
  agentConnectionLimitRejections: number;
  bufferedAmountBytes: number;
  maxBufferedAmountBytes: number;
}

export interface TransferPerformanceSnapshot {
  activeTasks: number;
  queuedSubTasks: number;
  activeSubTasks: number;
}

export interface RuntimePerformanceSources {
  webSockets(): WebSocketPerformanceSnapshot;
  activeExecutionSessions(): number;
  activeWorkspaceSessions(): number;
  transfers(): TransferPerformanceSnapshot;
}

export interface RuntimePerformanceReporter {
  stop(): void;
}

export const startRuntimePerformanceReporter = (
  sources: RuntimePerformanceSources,
  intervalMs = DEFAULT_REPORT_INTERVAL_MS,
): RuntimePerformanceReporter => {
  let collecting = false;
  let timer: NodeJS.Timeout | undefined;

  const report = (): void => {
    if (!collecting || !logger.isLevelEnabled('trace')) return;
    const interval = runtimePerformanceMetrics.snapshotAndReset();
    logger.trace(
      {
        metric: 'runtime.performance',
        intervalMs,
        eventLoop: interval.eventLoop,
        database: interval.database,
        http: interval.http,
        websocket: { ...interval.websocket, ...sources.webSockets() },
        ssh: { ...interval.ssh, activeSessions: sources.activeExecutionSessions() },
        workspace: { activeSessions: sources.activeWorkspaceSessions() },
        terminal: interval.terminal,
        sftp: interval.sftp,
        archive: interval.archive,
        transfer: { ...interval.transfer, ...sources.transfers() },
        cpu: interval.cpu,
        memory: interval.memory,
      },
      'Runtime performance sample',
    );
  };

  const stopTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const reconcileCollection = (): void => {
    const shouldCollect = logger.isLevelEnabled('trace');
    if (shouldCollect === collecting) return;
    collecting = shouldCollect;
    if (collecting) {
      runtimePerformanceMetrics.start();
      timer = setInterval(report, intervalMs);
      timer.unref?.();
    } else {
      stopTimer();
      runtimePerformanceMetrics.stop();
    }
  };

  reconcileCollection();
  const unsubscribeLevel = onBackendLogLevelChange(reconcileCollection);

  return {
    stop: () => {
      stopTimer();
      unsubscribeLevel();
      collecting = false;
      runtimePerformanceMetrics.stop();
    },
  };
};
