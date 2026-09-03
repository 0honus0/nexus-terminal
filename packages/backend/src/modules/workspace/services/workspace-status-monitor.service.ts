import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import type { ServerStatusCollector } from '../../../platform/system/server-status.port';
import type { SettingsService } from '../../settings/settings.service';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';

interface PollState {
  interval?: NodeJS.Timeout;
  bootstrap?: NodeJS.Timeout;
  fetching: boolean;
  subscribed: boolean;
}
export class WorkspaceStatusMonitorService {
  private readonly states = new Map<string, PollState>();
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly executions: ExecutionSessionManager,
    private readonly settings: SettingsService,
    private readonly collector: ServerStatusCollector,
    private readonly events: WorkspaceEventHub,
  ) {}
  async start(workspaceId: string): Promise<void> {
    const state = this.state(workspaceId);
    state.subscribed = true;
    if (state.interval) return;
    const workspace = this.sessions.get(workspaceId);
    if (!workspace) return;
    const execution = this.executions.get(workspace.executionSessionId);
    if (!execution?.isReady) return;
    let intervalMs = 3000;
    try {
      intervalMs = Math.max(1000, (await this.settings.getStatusMonitorIntervalSeconds()) * 1000);
    } catch {}
    if (!state.subscribed || state.interval) return;
    state.interval = setInterval(() => void this.fetch(workspaceId), intervalMs);
    void this.fetch(workspaceId, true);
  }
  stop(workspaceId: string): void {
    const state = this.states.get(workspaceId);
    if (!state) return;
    state.subscribed = false;
    if (state.interval) clearInterval(state.interval);
    if (state.bootstrap) clearTimeout(state.bootstrap);
    state.interval = undefined;
    state.bootstrap = undefined;
    this.collector.clear(workspaceId);
  }
  clear(workspaceId: string): void {
    this.stop(workspaceId);
    this.states.delete(workspaceId);
  }
  startStatusPolling(id: string) {
    return this.start(id);
  }
  stopStatusPolling(id: string) {
    this.stop(id);
  }
  clearSession(id: string) {
    this.clear(id);
  }
  private state(id: string) {
    let s = this.states.get(id);
    if (!s) {
      s = { fetching: false, subscribed: false };
      this.states.set(id, s);
    }
    return s;
  }
  private async fetch(id: string, bootstrap = false) {
    const state = this.state(id);
    if (state.fetching || !state.subscribed) return;
    const workspace = this.sessions.get(id);
    const execution = workspace ? this.executions.get(workspace.executionSessionId) : undefined;
    if (!workspace || !execution?.isReady) {
      this.stop(id);
      return;
    }
    state.fetching = true;
    try {
      const status = await this.collector.collect(execution, id);
      if (state.subscribed)
        this.events.publish(id, { type: 'status-update', connectionId: workspace.connectionId, status });
      if (bootstrap && state.subscribed && !state.bootstrap)
        state.bootstrap = setTimeout(() => {
          state.bootstrap = undefined;
          void this.fetch(id);
        }, 500);
    } catch (error) {
      if (state.subscribed)
        this.events.publish(id, {
          type: 'status-error',
          connectionId: workspace.connectionId,
          message: `获取状态失败: ${error instanceof Error ? error.message : String(error)}`,
        });
    } finally {
      state.fetching = false;
    }
  }
}
