import type { AgentSettingsView } from './agent-settings.service';
import type { AppObservedState, AppView } from './app.types';

export type AgentAvailabilityState = 'disabled' | 'enabling' | 'enabled' | 'degraded' | 'unavailable';

export interface AgentAvailabilityView {
  state: AgentAvailabilityState;
  reason: string | null;
  appId: string | null;
  appHealth: AppObservedState | null;
}

const executable = (app: AppView): boolean => app.capabilities.includes('runs.execute');

export const resolveAgentAvailability = (
  settings: AgentSettingsView,
  apps: readonly AppView[],
): AgentAvailabilityView => {
  if (!settings.effectiveSettings.feature.enabled) {
    return { state: 'disabled', reason: null, appId: null, appHealth: null };
  }

  const enabledApps = apps.filter((app) => executable(app) && app.desiredState === 'enabled');
  const healthy = enabledApps.find((app) => app.observedState === 'running');
  if (healthy) return { state: 'enabled', reason: null, appId: healthy.appId, appHealth: healthy.observedState };

  const degraded = enabledApps.find((app) => app.observedState === 'degraded');
  if (degraded) {
    return {
      state: 'degraded',
      reason: degraded.healthReason,
      appId: degraded.appId,
      appHealth: degraded.observedState,
    };
  }

  const enabling = enabledApps.find((app) => app.observedState === 'enabling');
  if (enabling) {
    return {
      state: 'enabling',
      reason: enabling.healthReason,
      appId: enabling.appId,
      appHealth: enabling.observedState,
    };
  }

  const failed = enabledApps.find((app) => app.observedState === 'failed');
  if (failed) {
    return {
      state: 'unavailable',
      reason: failed.healthReason ?? 'AGENT_APP_FAILED',
      appId: failed.appId,
      appHealth: failed.observedState,
    };
  }

  const transitioning = enabledApps[0];
  if (transitioning) {
    return {
      state: 'unavailable',
      reason: transitioning.healthReason ?? 'AGENT_APP_NOT_READY',
      appId: transitioning.appId,
      appHealth: transitioning.observedState,
    };
  }

  return { state: 'unavailable', reason: 'NO_ENABLED_AGENT_APP', appId: null, appHealth: null };
};
