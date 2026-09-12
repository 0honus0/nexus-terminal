import { reactive, readonly } from 'vue';
import { logger } from '@/client/logging/logger';

export interface AgentHubBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AgentHubStatus = 'closed' | 'opening' | 'visible' | 'minimized' | 'error';

interface AgentHubState {
  status: AgentHubStatus;
  bounds: AgentHubBounds;
  maximized: boolean;
  activeAppId: string | null;
  recentAppIds: string[];
  hubView: 'conversation' | 'files';
  launcherPosition: { right: number; bottom: number };
}

const DEFAULT_BOUNDS: AgentHubBounds = { x: 120, y: 96, width: 1080, height: 700 };
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;
const MARGIN = 12;
const TOP_MARGIN = 64;

const state = reactive<AgentHubState>({
  status: 'closed',
  bounds: { ...DEFAULT_BOUNDS },
  maximized: false,
  activeAppId: null,
  recentAppIds: [],
  hubView: 'conversation',
  launcherPosition: { right: 22, bottom: 24 },
});

const viewport = (): { width: number; height: number } => ({
  width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
  height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0),
});

const clampBounds = (bounds: AgentHubBounds): AgentHubBounds => {
  const screen = viewport();
  const maxWidth = Math.max(320, screen.width - MARGIN * 2);
  const maxHeight = Math.max(240, screen.height - TOP_MARGIN - MARGIN);
  const effectiveMinWidth = Math.min(MIN_WIDTH, maxWidth);
  const effectiveMinHeight = Math.min(MIN_HEIGHT, maxHeight);
  const width = Math.min(Math.max(bounds.width, effectiveMinWidth), maxWidth);
  const height = Math.min(Math.max(bounds.height, effectiveMinHeight), maxHeight);
  const x = Math.min(Math.max(bounds.x, MARGIN), Math.max(MARGIN, screen.width - width - MARGIN));
  const y = Math.min(Math.max(bounds.y, TOP_MARGIN), Math.max(TOP_MARGIN, screen.height - height - MARGIN));
  return { x, y, width, height };
};

const storageKey = (userId: number): string => `nexus.agent.surface.v1.user.${userId}`;

const parseStored = (raw: string | null): Partial<AgentHubState> | null => {
  if (!raw || raw.length > 8 * 1024) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schemaVersion !== 1) return null;
    return value as Partial<AgentHubState>;
  } catch {
    return null;
  }
};

const rememberApp = (appId: string): void => {
  state.recentAppIds = [appId, ...state.recentAppIds.filter((candidate) => candidate !== appId)].slice(0, 8);
};

const logContext = () => ({
  status: state.status,
  maximized: state.maximized,
  activeAppId: state.activeAppId,
  hubView: state.hubView,
  bounds: { ...state.bounds },
  launcherPosition: { ...state.launcherPosition },
});

export const agentWindowManager = {
  state: readonly(state),
  openHub(input: { restoreRecent?: boolean; appId?: string } = {}): void {
    const previousStatus = state.status;
    state.status = 'opening';
    if (input.appId) {
      state.activeAppId = input.appId;
      rememberApp(input.appId);
    } else if (input.restoreRecent && !state.activeAppId && state.recentAppIds[0]) {
      state.activeAppId = state.recentAppIds[0];
    }
    state.bounds = clampBounds(state.bounds);
    state.status = 'visible';
    logger.debug(
      { previousStatus, requestedAppId: input.appId ?? null, ...logContext() },
      'Agent floating window opened',
    );
  },
  switchApp(input: { appId: string; threadId?: string }): void {
    const previousAppId = state.activeAppId;
    state.activeAppId = input.appId;
    rememberApp(input.appId);
    state.hubView = 'conversation';
    logger.debug({ previousAppId, ...logContext() }, 'Agent floating window app switched');
  },
  setHubView(view: 'conversation' | 'files'): void {
    if (state.hubView === view) return;
    const previousView = state.hubView;
    state.hubView = view;
    logger.debug({ previousView, ...logContext() }, 'Agent floating window view changed');
  },
  setLauncherPosition(position: { right: number; bottom: number }): void {
    const screen = viewport();
    state.launcherPosition = {
      right: Math.max(12, Math.min(position.right, Math.max(12, screen.width - 72))),
      bottom: Math.max(12, Math.min(position.bottom, Math.max(12, screen.height - 72))),
    };
  },
  restoreForUser(userId: number): void {
    try {
      const raw = window.localStorage.getItem(storageKey(userId));
      const stored = parseStored(raw);
      if (!stored) {
        if (raw) logger.warn({ userId, storedBytes: raw.length }, 'Ignored invalid Agent floating window layout');
        return;
      }
      const bounds = stored.bounds;
      if (
        bounds &&
        Number.isFinite(bounds.x) &&
        Number.isFinite(bounds.y) &&
        Number.isFinite(bounds.width) &&
        Number.isFinite(bounds.height)
      ) {
        state.bounds = clampBounds(bounds);
      }
      state.maximized = stored.maximized === true;
      state.recentAppIds = Array.isArray(stored.recentAppIds)
        ? stored.recentAppIds.filter((value): value is string => typeof value === 'string').slice(0, 8)
        : [];
      state.activeAppId = state.recentAppIds[0] ?? null;
      const launcher = stored.launcherPosition;
      if (launcher && Number.isFinite(launcher.right) && Number.isFinite(launcher.bottom)) {
        this.setLauncherPosition(launcher);
      }
      logger.debug({ userId, ...logContext() }, 'Agent floating window layout restored');
    } catch (cause) {
      logger.warn({ err: cause, userId }, 'Failed to restore Agent floating window layout');
    }
  },
  persistForUser(userId: number): void {
    try {
      const payload = JSON.stringify({
        schemaVersion: 1,
        bounds: state.bounds,
        maximized: state.maximized,
        launcherPosition: state.launcherPosition,
        recentAppIds: state.recentAppIds,
      });
      if (payload.length > 8 * 1024) {
        logger.warn({ userId, payloadBytes: payload.length }, 'Skipped oversized Agent floating window layout');
        return;
      }
      window.localStorage.setItem(storageKey(userId), payload);
      logger.debug({ userId, ...logContext() }, 'Agent floating window layout persisted');
    } catch (cause) {
      logger.warn({ err: cause, userId }, 'Failed to persist Agent floating window layout');
    }
  },
  minimizeHub(): void {
    if (state.status === 'closed') return;
    const previousStatus = state.status;
    state.status = 'minimized';
    logger.debug({ previousStatus, ...logContext() }, 'Agent floating window minimized');
  },
  closeHub(): void {
    if (state.status === 'closed' && !state.maximized) return;
    const previousStatus = state.status;
    state.status = 'closed';
    state.maximized = false;
    logger.debug({ previousStatus, ...logContext() }, 'Agent floating window closed');
  },
  toggleMaximize(): void {
    const previousMaximized = state.maximized;
    state.maximized = !state.maximized;
    if (!state.maximized) state.bounds = clampBounds(state.bounds);
    logger.debug({ previousMaximized, ...logContext() }, 'Agent floating window maximize state changed');
  },
  setBounds(bounds: AgentHubBounds): void {
    state.bounds = clampBounds(bounds);
  },
  clamp(): void {
    state.bounds = clampBounds(state.bounds);
  },
  reset(): void {
    const previous = logContext();
    state.status = 'closed';
    state.bounds = { ...DEFAULT_BOUNDS };
    state.maximized = false;
    state.activeAppId = null;
    state.recentAppIds = [];
    state.hubView = 'conversation';
    state.launcherPosition = { right: 22, bottom: 24 };
    logger.debug({ previous, ...logContext() }, 'Agent floating window state reset');
  },
};
