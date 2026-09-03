import { WebSocket } from 'ws';
import type { WorkspaceSessionRegistry } from './workspace-session-registry';
import { settingsService } from '../settings/settings.service';
import { ServerStatusCollector } from '../../platform/system/server-status.collector';

/** Workspace-only polling adapter around the reusable server status collector. */
export class WorkspaceStatusMonitorService {
  private readonly fetchInFlight = new Set<string>();
  private readonly subscribedSessions = new Set<string>();
  private readonly startInFlight = new Set<string>();
  private readonly bootstrapSamplePending = new Set<string>();
  private readonly bootstrapTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly workspaceSessionRegistry: WorkspaceSessionRegistry,
    private readonly collector = new ServerStatusCollector(),
  ) {}

  async startStatusPolling(sessionId: string): Promise<void> {
    this.subscribedSessions.add(sessionId);
    const initialState = this.workspaceSessionRegistry.get(sessionId);
    if (!initialState?.executionSession.isReady || initialState.statusIntervalId || this.startInFlight.has(sessionId)) return;

    this.startInFlight.add(sessionId);
    try {
      let intervalMs = 3000;
      try {
        intervalMs = Math.max(1000, (await settingsService.getStatusMonitorIntervalSeconds()) * 1000);
      } catch (error) {
        console.error(`[StatusMonitor ${sessionId}] 获取轮询间隔设置失败，使用默认值 3000ms:`, error);
      }

      const state = this.workspaceSessionRegistry.get(sessionId);
      if (!this.subscribedSessions.has(sessionId) || !state?.executionSession.isReady || state.statusIntervalId) return;

      this.bootstrapSamplePending.add(sessionId);
      state.statusIntervalId = setInterval(() => void this.fetchAndSendServerStatus(sessionId), intervalMs);
      void this.fetchAndSendServerStatus(sessionId);
    } finally {
      this.startInFlight.delete(sessionId);
    }
  }

  stopStatusPolling(sessionId: string): void {
    this.subscribedSessions.delete(sessionId);
    const state = this.workspaceSessionRegistry.get(sessionId);
    if (state?.statusIntervalId) {
      clearInterval(state.statusIntervalId);
      state.statusIntervalId = undefined;
    }

    const bootstrapTimer = this.bootstrapTimers.get(sessionId);
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    this.bootstrapTimers.delete(sessionId);
    this.bootstrapSamplePending.delete(sessionId);
    this.collector.clear(sessionId);
  }

  clearSession(sessionId: string): void {
    this.stopStatusPolling(sessionId);
    this.startInFlight.delete(sessionId);
  }

  private async fetchAndSendServerStatus(sessionId: string): Promise<void> {
    if (this.fetchInFlight.has(sessionId)) return;

    const state = this.workspaceSessionRegistry.get(sessionId);
    if (!state?.executionSession.isReady || state.ws.readyState !== WebSocket.OPEN) {
      this.stopStatusPolling(sessionId);
      return;
    }

    this.fetchInFlight.add(sessionId);
    try {
      const status = await this.collector.collect(state.executionSession.client, sessionId);
      if (state.ws.readyState === WebSocket.OPEN && state.statusIntervalId) {
        state.ws.send(JSON.stringify({ type: 'status_update', payload: { connectionId: state.dbConnectionId, status } }));
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
}
