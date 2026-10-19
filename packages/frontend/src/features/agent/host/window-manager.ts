import { reactive, readonly } from 'vue';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { logger } from '@/client/logging/logger';
import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';

interface AgentHubBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

type AgentHubStatus = 'closed' | 'opening' | 'visible' | 'minimized';

interface AgentHubState {
	status: AgentHubStatus;
	bounds: AgentHubBounds;
	maximized: boolean;
	activeAppId: string | null;
	recentAppIds: string[];
	hubView: 'conversation' | 'files';
	launcherPosition: { right: number; bottom: number };
	launcherDock: 'left' | 'right' | null;
}

interface StoredAgentHubState {
	schemaVersion: 2;
	bounds: AgentHubBounds;
	maximized: boolean;
	recentAppIds: string[];
	hubView: 'conversation' | 'files';
	launcherPosition: { right: number; bottom: number };
	launcherDock: 'left' | 'right' | null;
}

function readStoredHub(value: unknown): StoredAgentHubState | undefined {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('schemaVersion' in value) ||
		value.schemaVersion !== 2 ||
		!('bounds' in value) ||
		!('launcherPosition' in value) ||
		!('maximized' in value) ||
		!('recentAppIds' in value) ||
		!('hubView' in value) ||
		!('launcherDock' in value)
	)
		return undefined;
	const bounds = value.bounds;
	const launcher = value.launcherPosition;
	if (
		!bounds ||
		typeof bounds !== 'object' ||
		!('x' in bounds) ||
		!('y' in bounds) ||
		!('width' in bounds) ||
		!('height' in bounds) ||
		typeof bounds.x !== 'number' ||
		typeof bounds.y !== 'number' ||
		typeof bounds.width !== 'number' ||
		typeof bounds.height !== 'number' ||
		![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
		bounds.width <= 0 ||
		bounds.height <= 0
	)
		return undefined;
	if (
		!launcher ||
		typeof launcher !== 'object' ||
		!('right' in launcher) ||
		!('bottom' in launcher) ||
		typeof launcher.right !== 'number' ||
		typeof launcher.bottom !== 'number' ||
		!Number.isFinite(launcher.right) ||
		!Number.isFinite(launcher.bottom)
	)
		return undefined;
	if (
		typeof value.maximized !== 'boolean' ||
		!Array.isArray(value.recentAppIds) ||
		value.recentAppIds.length > 8 ||
		!value.recentAppIds.every((id): id is string => typeof id === 'string' && AGENT_ID_PATTERN.test(id)) ||
		(value.hubView !== 'conversation' && value.hubView !== 'files') ||
		(value.launcherDock !== 'left' && value.launcherDock !== 'right' && value.launcherDock !== null)
	)
		return undefined;
	return {
		schemaVersion: 2,
		bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
		maximized: value.maximized,
		recentAppIds: value.recentAppIds.map((id) => id),
		hubView: value.hubView,
		launcherPosition: { right: launcher.right, bottom: launcher.bottom },
		launcherDock: value.launcherDock,
	};
}

const DEFAULT_BOUNDS: AgentHubBounds = { x: 80, y: 16, width: 1180, height: 740 };
const MIN_WIDTH = 560;
/*
 * §7.2-a: at 380px the hub chrome (44px header + 40px surface bar) plus the
 * composer left the transcript about 94px tall over CDP. 480 keeps two
 * readable rows even before the short-window composer compaction kicks in.
 */
const MIN_HEIGHT = 480;
const DEFAULT_LAUNCHER_POSITION = { right: 22, bottom: 24 } as const;

const createDefaultState = (): AgentHubState => ({
	status: 'closed',
	bounds: { ...DEFAULT_BOUNDS },
	maximized: false,
	activeAppId: null,
	recentAppIds: [],
	hubView: 'conversation',
	launcherPosition: { ...DEFAULT_LAUNCHER_POSITION },
	launcherDock: null,
});

export const createAgentWindowManager = () => {
	let preferredLauncherPosition: { right: number; bottom: number } = { ...DEFAULT_LAUNCHER_POSITION };
	const state = reactive<AgentHubState>(createDefaultState());

	// Keep the user's intended bounds separate from viewport-clamped render bounds.
	// Temporary viewport shrinkage (for example docked DevTools) can then be reversed
	// when the viewport grows again without losing the user's chosen position or size.
	let preferredBounds: AgentHubBounds = { ...DEFAULT_BOUNDS };

	const resetStateToDefaults = (): void => {
		const defaults = createDefaultState();
		preferredBounds = { ...defaults.bounds };
		preferredLauncherPosition = { ...defaults.launcherPosition };
		Object.assign(state, defaults);
	};

	const viewport = (): { width: number; height: number } => ({
		width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
		height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0),
	});

	const clampBounds = (bounds: AgentHubBounds): AgentHubBounds => {
		const screen = viewport();
		const maxWidth = Math.max(1, screen.width);
		const maxHeight = Math.max(1, screen.height);
		const width = Math.min(Math.max(bounds.width, Math.min(MIN_WIDTH, maxWidth)), maxWidth);
		const height = Math.min(Math.max(bounds.height, Math.min(MIN_HEIGHT, maxHeight)), maxHeight);

		// Keep the entire floating window inside the viewport on every edge.
		const x = Math.min(Math.max(bounds.x, 0), Math.max(0, screen.width - width));
		const y = Math.min(Math.max(bounds.y, 0), Math.max(0, screen.height - height));

		return { x, y, width, height };
	};

	const clampLauncherPosition = (position: { right: number; bottom: number }): { right: number; bottom: number } => {
		const screen = viewport();
		const width = window.innerWidth;
		return {
			right:
				state.launcherDock === 'right'
					? 0
					: state.launcherDock === 'left'
						? Math.max(0, width - 44)
						: Math.max(0, Math.min(position.right, Math.max(0, width - 44))),
			bottom: Math.max(12, Math.min(position.bottom, Math.max(12, screen.height - 72))),
		};
	};

	const storageForUser = (userId: number) => ({
		namespace: 'agent.surface',
		version: 2,
		scope: { kind: 'user', id: userId } as const,
		codec: jsonStorageCodec<StoredAgentHubState>(readStoredHub),
	});

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

	const agentWindowManager = {
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
			state.bounds = clampBounds(preferredBounds);
			state.status = 'visible';
			logger.debug(
				{ previousStatus, requestedAppId: input.appId ?? null, ...logContext() },
				'Agent floating window opened',
			);
		},

		switchApp(input: { appId: string }): void {
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
			state.launcherDock = null;
			preferredLauncherPosition = { ...position };
			state.launcherPosition = clampLauncherPosition(preferredLauncherPosition);
		},

		dockLauncher(side: 'left' | 'right'): void {
			state.launcherDock = side;
			state.launcherPosition = clampLauncherPosition(preferredLauncherPosition);
		},

		clampLauncherPosition(): void {
			state.launcherPosition = clampLauncherPosition(preferredLauncherPosition);
		},

		resetLauncherPosition(): void {
			agentWindowManager.setLauncherPosition({ ...DEFAULT_LAUNCHER_POSITION });
		},

		restoreForUser(userId: number): void {
			resetStateToDefaults();
			try {
				const stored = readStoredValue(storageForUser(userId));
				if (!stored) return;
				const bounds = stored.bounds;
				if (
					bounds &&
					Number.isFinite(bounds.x) &&
					Number.isFinite(bounds.y) &&
					Number.isFinite(bounds.width) &&
					Number.isFinite(bounds.height)
				) {
					preferredBounds = { ...bounds };
					state.bounds = clampBounds(preferredBounds);
				}
				state.maximized = stored.maximized === true;
				if (stored.hubView === 'conversation' || stored.hubView === 'files') state.hubView = stored.hubView;
				state.recentAppIds = Array.isArray(stored.recentAppIds)
					? stored.recentAppIds.filter((value): value is string => typeof value === 'string').slice(0, 8)
					: [];
				state.activeAppId = state.recentAppIds[0] ?? null;
				const launcher = stored.launcherPosition;
				if (launcher && Number.isFinite(launcher.right) && Number.isFinite(launcher.bottom)) {
					this.setLauncherPosition(launcher);
					if (stored.launcherDock === 'left' || stored.launcherDock === 'right') {
						this.dockLauncher(stored.launcherDock);
					}
				}
				logger.debug({ userId, ...logContext() }, 'Agent floating window layout restored');
			} catch (cause) {
				logger.warn({ err: cause, userId }, 'Failed to restore Agent floating window layout');
			}
		},

		persistForUser(userId: number): void {
			try {
				const stored: StoredAgentHubState = {
					schemaVersion: 2,
					bounds: preferredBounds,
					maximized: state.maximized,
					launcherPosition: preferredLauncherPosition,
					launcherDock: state.launcherDock,
					recentAppIds: state.recentAppIds,
					hubView: state.hubView,
				};
				const payloadBytes = JSON.stringify(stored).length;
				if (payloadBytes > 8 * 1024) {
					logger.warn({ userId, payloadBytes }, 'Skipped oversized Agent floating window layout');
					return;
				}
				writeStoredValue(storageForUser(userId), stored);
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
			if (!state.maximized) state.bounds = clampBounds(preferredBounds);
			logger.debug({ previousMaximized, ...logContext() }, 'Agent floating window maximize state changed');
		},

		setBounds(bounds: AgentHubBounds): void {
			const next = clampBounds(bounds);
			preferredBounds = { ...next };
			state.bounds = next;
		},

		resize(width: number, height: number, origin: AgentHubBounds = state.bounds): void {
			const screen = viewport();
			const centerX = origin.x + origin.width / 2;
			const centerY = origin.y + origin.height / 2;
			// Resize symmetrically around the current window center, stopping when
			// either edge reaches the viewport instead of shifting the center.
			const maxWidth = Math.max(1, 2 * Math.min(centerX, screen.width - centerX));
			const maxHeight = Math.max(1, 2 * Math.min(centerY, screen.height - centerY));
			const nextWidth = Math.min(Math.max(width, Math.min(MIN_WIDTH, maxWidth)), maxWidth);
			const nextHeight = Math.min(Math.max(height, Math.min(MIN_HEIGHT, maxHeight)), maxHeight);
			const next = clampBounds({
				x: centerX - nextWidth / 2,
				y: centerY - nextHeight / 2,
				width: nextWidth,
				height: nextHeight,
			});
			preferredBounds = { ...next };
			state.bounds = next;
		},

		clamp(): void {
			state.bounds = clampBounds(preferredBounds);
			state.launcherPosition = clampLauncherPosition(preferredLauncherPosition);
		},

		reset(): void {
			const previous = logContext();
			resetStateToDefaults();
			logger.debug({ previous, ...logContext() }, 'Agent floating window state reset');
		},
	};

	return agentWindowManager;
};

export type AgentWindowManager = ReturnType<typeof createAgentWindowManager>;
