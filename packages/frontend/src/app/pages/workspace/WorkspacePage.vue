<script setup lang="ts">
	import { isNetworkFailure } from '@/client/http/network-failure';
	import {
		computed,
		defineAsyncComponent,
		nextTick,
		onActivated,
		onBeforeUnmount,
		onDeactivated,
		onMounted,
		ref,
		watch,
	} from 'vue';
	import { useRoute, useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { logger } from '@/client/logging/logger';
	import { useDeviceCapabilities } from '@/foundation/browser';
	import { createLatestValueSaver } from '@/foundation/async';
	import { useFeedback, preferenceFailureMessage } from '@/shared/feedback/public';
	import { registerAuthenticatedSessionReset } from '@/shared/session/public';
	import { focusRegistry, normalizeShortcut, shortcutFromKeyboardEvent } from '@/shared/focus/public';
	import { refreshConnection, type ConnectionSummary } from '@/features/connections/public';
	import { terminalScrollbackForRuntime, usePreferences } from '@/features/preferences/public';
	import { defaultTerminalTheme, useAppearance } from '@/features/appearance/public';
	import { useCommandHistory } from '@/features/command-history/public';
	import { remoteDesktopLauncher } from '@/features/remote-desktop/public';
	import { useRemoteTools, RemoteToolInstallDialog } from '@/features/remote-tools/public';
	import {
		loadProgressDisplayModal,
		TransferFailure,
		transferTaskErrorDescriptor,
		transferTaskWarningDescriptor,
		isProgressTaskVisible,
		useServerTransfers,
		useTransferCredentialConfirmation,
		type FileClipboardOperation,
		type ProgressSource,
		type TransferTask,
	} from '@/features/transfers/public';
	import type { RemoteFileEntry } from '@/features/filesystem/public';
	import {
		loadSuspendedSessionsModal,
		findSuspendedSessionByOriginalWorkspace,
		findSuspendedSessionById,
		refreshSuspendedSessionsCatalog,
		type SuspendedSession,
	} from '@/features/ssh-suspend/public';
	import {
		WorkspaceStartPage,
		WorkspaceTabBar,
		provideWorkspaceUiState,
		workspaceRuntimeRegistry,
		type WorkspaceRuntimeSession,
		loadWorkspaceLayoutConfigurator,
		loadWorkspaceFocusConfigurator,
		loadWorkspaceSessionSurface,
		preloadWorkspaceTerminalSurface,
	} from '@/runtimes/workspace/presentation/public';

	const ProgressDisplayModal = defineAsyncComponent(loadProgressDisplayModal);
	const SuspendedSessionsModal = defineAsyncComponent(loadSuspendedSessionsModal);
	const WorkspaceLayoutConfigurator = defineAsyncComponent(loadWorkspaceLayoutConfigurator);
	const WorkspaceFocusConfigurator = defineAsyncComponent(loadWorkspaceFocusConfigurator);
	const WorkspaceSessionSurface = defineAsyncComponent(loadWorkspaceSessionSurface);

	interface SurfaceApi {
		terminalSnapshot?: () => Promise<string>;
		focusTerminal?: () => void;
		fitTerminal?: () => void;
		prepareTerminal?: () => void;
		scrollTerminalToBottom?: () => void;
	}

	const route = useRoute();
	const { layout: workspaceLayout, focus: workspaceFocus } = provideWorkspaceUiState();
	const router = useRouter();
	const { t } = useI18n();
	const feedback = useFeedback();
	const confirmTransferCredentials = useTransferCredentialConfirmation();
	const clipboardTools = useRemoteTools();
	const clipboardToolTargetName = computed(() => {
		const targetId = clipboardTools.offer.value?.targetId;
		const session = registry.orderedSessions.value.find((item) => item.connection.id === targetId);
		return session?.connection.name || session?.connection.host;
	});

	const transferErrorMessage = (task: TransferTask): string => {
		const descriptor = transferTaskErrorDescriptor(task);
		return descriptor ? t(descriptor.key, descriptor.params ?? {}) : t('progressCenter.error.unknown');
	};

	const device = useDeviceCapabilities();
	const viewportRoot = ref<HTMLElement | null>(null);
	const visibleWorkspaceHeight = ref<number>();
	let viewportFrame: number | undefined;

	const cancelViewportSync = () => {
		if (viewportFrame !== undefined) window.cancelAnimationFrame(viewportFrame);
		viewportFrame = undefined;
	};

	const syncViewport = () => {
		if (!workspaceActive || document.visibilityState !== 'visible') return;
		const viewport = window.visualViewport;
		const element = viewportRoot.value;
		if (!device.supportsTouchInteraction.value || !viewport || !element?.isConnected) {
			visibleWorkspaceHeight.value = undefined;
			return;
		}
		// 100dvh need not shrink for the software keyboard. Keep the existing layout
		// inside the visible viewport so ResizeObserver can fit the terminal correctly.
		const height = viewport.height + viewport.offsetTop - element.getBoundingClientRect().top;
		if (Number.isFinite(height) && height > 0) visibleWorkspaceHeight.value = Math.floor(height);
	};

	const scheduleViewportSync = () => {
		// Keyboard geometry must not wait for an animation frame left over from
		// before a browser freeze. The next frame only settles subsequent layout.
		syncViewport();
		if (!workspaceActive || document.visibilityState !== 'visible' || viewportFrame !== undefined) return;
		viewportFrame = window.requestAnimationFrame(() => {
			viewportFrame = undefined;
			syncViewport();
		});
	};

	const preferences = usePreferences();
	watch(() => [preferences.values.value.navBarVisible, device.supportsTouchInteraction.value], scheduleViewportSync, {
		flush: 'post',
	});
	const appearance = useAppearance();
	const appearanceSettings = appearance.settings;
	const appearanceThemes = appearance.themes;
	const history = useCommandHistory();
	const serverTransfers = useServerTransfers();
	const registry = workspaceRuntimeRegistry;
	const SESSION_RECONCILE_ATTEMPTS = 10;
	const SESSION_RECONCILE_DELAY_MS = 400;
	let sessionReconcilePromise: Promise<void> | null = null;
	let sessionReconcileRequested = false;
	let workspaceActive = false;
	let pageScope = new AbortController();

	const isPageCurrent = (signal: AbortSignal): boolean =>
		workspaceActive &&
		router.currentRoute.value.name === 'Workspace' &&
		pageScope.signal === signal &&
		!signal.aborted;

	const revokePageActions = (): void => {
		pageScope.abort();
		activationGeneration += 1;
		preparingSessionId.value = null;
		sessionReconcilePromise = null;
		sessionReconcileRequested = false;
	};

	const activatePageActions = (): void => {
		workspaceActive = true;
		if (pageScope.signal.aborted) pageScope = new AbortController();
	};

	const waitForReconciliation = (signal: AbortSignal): Promise<void> => {
		if (signal.aborted) return Promise.resolve();
		return new Promise((resolve) => {
			const finish = (): void => {
				window.clearTimeout(timer);
				signal.removeEventListener('abort', finish);
				resolve();
			};

			const timer = window.setTimeout(finish, SESSION_RECONCILE_DELAY_MS);
			signal.addEventListener('abort', finish, { once: true });
		});
	};

	const workspaceVisible = ref(true);
	watch(registry.suspendAutoTerminationNotice, (notice) => {
		if (!notice) return;
		const name =
			notice.name ??
			`${t('sshSuspend.notifications.defaultSessionName')} ${notice.suspendedSessionId.slice(0, 8)}`;
		feedback.notifyWarning(
			t('sshSuspend.notifications.autoTerminated', { name, reason: t(`sshSuspend.reasons.${notice.reason}`) }),
		);
	});
	const surfaces = new Map<string, SurfaceApi>();
	const suspendedVisible = ref(false);
	const connectionPickerVisible = ref(false);
	const layoutConfiguratorVisible = ref(false);
	const progressDisplayVisible = ref(false);
	const terminalFontPreview = ref<number | null>(null);
	const fileManagerRowScalePreview = ref<number | null>(null);
	const statusScalePreview = ref<number | null>(null);
	const quickCommandScalePreview = ref<number | null>(null);
	const markedSuspendedSessions = computed(() =>
		registry.orderedSessions.value
			.filter((session) => session.markedForSuspend.value && session.markedForSuspendAt.value)
			.map((session) => ({
				workspaceId: session.id,
				connectionId: session.connection.id,
				connectionName: session.connection.name || session.connection.host,
				markedAt: session.markedForSuspendAt.value!,
			})),
	);
	const progressVisibility = ref<Record<string, boolean>>({});

	const reportPreferenceSaveError = (cause: unknown) =>
		feedback.notifyError(
			t('settings.preferences.saveFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
		);

	watch(
		() =>
			registry.orderedSessions.value.map((session) => ({
				id: session.id,
				taskIds: session.transferController.tasks.value.map((task) => task.id),
			})),
		(current, previous = []) => {
			const previousBySession = new Map(previous.map((entry) => [entry.id, new Set(entry.taskIds)]));
			let nextVisibility: Record<string, boolean> | undefined;
			for (const entry of current) {
				const previousIds = previousBySession.get(entry.id) ?? new Set<string>();
				if (!entry.taskIds.some((id) => !previousIds.has(id))) continue;
				if (progressVisibility.value[entry.id] !== false) continue;
				nextVisibility ??= { ...progressVisibility.value };
				nextVisibility[entry.id] = true;
			}
			if (nextVisibility) progressVisibility.value = nextVisibility;
		},
		{ flush: 'sync' },
	);
	const statusScaleSaver = createLatestValueSaver<{ scale: number; permission: AbortSignal }>({
		delayMs: 240,

		save: ({ scale, permission }) =>
			permission.aborted ? Promise.resolve() : preferences.savePanelScale('status', scale, permission),

		onPendingChange: (pending) => {
			if (!pending) statusScalePreview.value = null;
		},

		onError: reportPreferenceSaveError,
	});
	const fileManagerRowScaleSaver = createLatestValueSaver<{
		scale: number;
		permission: AbortSignal;
	}>({
		delayMs: 240,

		save: ({ scale, permission }) =>
			permission.aborted ? Promise.resolve() : preferences.savePanelScale('files', scale, permission),

		onPendingChange: (pending) => {
			if (!pending) fileManagerRowScalePreview.value = null;
		},

		onError: reportPreferenceSaveError,
	});
	const quickCommandRowScaleSaver = createLatestValueSaver<{
		scale: number;
		permission: AbortSignal;
	}>({
		delayMs: 240,

		save: ({ scale, permission }) =>
			permission.aborted ? Promise.resolve() : preferences.savePanelScale('quick-commands', scale, permission),

		onPendingChange: (pending) => {
			if (!pending) quickCommandScalePreview.value = null;
		},

		onError: reportPreferenceSaveError,
	});

	const terminalFontSaver = createLatestValueSaver<{
		mobile: boolean;
		size: number;
		permission: AbortSignal;
	}>({
		delayMs: 240,

		save: ({ mobile, size, permission }) =>
			permission.aborted
				? Promise.resolve()
				: appearance.saveFontPreference(mobile ? 'mobile-terminal' : 'terminal', size, permission),

		onPendingChange: (pending) => {
			if (!pending) {
				terminalFontPreview.value = null;
				appearance.clearFontPreview('terminal');
			}
		},

		onError: () => feedback.notifyError(t('common.errorOccurred')),
	});
	const editorFontSaver = createLatestValueSaver<{ size: number; permission: AbortSignal }>({
		delayMs: 240,

		save: ({ size, permission }) =>
			permission.aborted ? Promise.resolve() : appearance.saveFontPreference('editor', size, permission),

		onPendingChange: (pending) => {
			if (!pending) {
				appearance.clearFontPreview('editor');
			}
		},

		onError: () => feedback.notifyError(t('common.errorOccurred')),
	});
	const mobileEditorFontSaver = createLatestValueSaver<{
		size: number;
		permission: AbortSignal;
	}>({
		delayMs: 240,

		save: ({ size, permission }) =>
			permission.aborted ? Promise.resolve() : appearance.saveFontPreference('mobile-editor', size, permission),

		onPendingChange: (pending) => {
			if (!pending) {
				appearance.clearFontPreview('mobile-editor');
			}
		},

		onError: () => feedback.notifyError(t('common.errorOccurred')),
	});

	const scheduleStatusScale = (scale: number) => {
		statusScalePreview.value = scale;
		statusScaleSaver.schedule({ scale, permission: pageScope.signal });
	};

	const scheduleQuickCommandScale = (scale: number) => {
		quickCommandScalePreview.value = scale;
		quickCommandRowScaleSaver.schedule({ scale, permission: pageScope.signal });
	};

	const saveFileManagerColumnWidths = (widths: Record<string, number>) => {
		void preferences
			.update({ fileManagerColWidths: widths }, preferences.version.value, pageScope.signal)
			.catch(reportPreferenceSaveError);
	};

	const updateTerminalFontSize = (size: number) => {
		terminalFontPreview.value = size;
		appearance.previewSettings(
			device.isMobile.value ? { terminalFontSizeMobile: size } : { terminalFontSize: size },
		);
		terminalFontSaver.schedule({
			mobile: device.isMobile.value,
			size,
			permission: pageScope.signal,
		});
	};

	const updateFileManagerRowScale = (scale: number) => {
		fileManagerRowScalePreview.value = scale;
		fileManagerRowScaleSaver.schedule({ scale, permission: pageScope.signal });
	};

	const updateEditorFontSize = (size: number) => {
		appearance.previewSettings({ editorFontSize: size });
		editorFontSaver.schedule({ size, permission: pageScope.signal });
	};

	const updateMobileEditorFontSize = (size: number) => {
		appearance.previewSettings({ mobileEditorFontSize: size });
		mobileEditorFontSaver.schedule({ size, permission: pageScope.signal });
	};

	const focusConfiguratorVisible = ref(false);
	let altCycleCandidate = false;
	let stopServerTransferPolling: (() => void) | undefined;

	const clipboardCount = computed(() => registry.fileClipboard.count.value);
	const hiddenProgressSources = computed<ProgressSource[]>(() =>
		registry.orderedSessions.value
			.filter(
				(session) =>
					progressVisibility.value[session.id] === false &&
					session.transferController.tasks.value.some(
						(task) => task.status !== 'cancelled' && isProgressTaskVisible(task),
					),
			)
			.map((session) => ({
				id: session.id,
				label: session.connection.name || session.connection.host,
				tasks: session.transferController.tasks.value.filter(
					(task) => task.status !== 'cancelled' && isProgressTaskVisible(task),
				),
			})),
	);
	const progressDisplaySources = hiddenProgressSources;

	const setProgressVisible = (sessionId: string, visible: boolean) => {
		progressVisibility.value = { ...progressVisibility.value, [sessionId]: visible };
	};

	const restoreProgressSource = (sessionId: string) => {
		setProgressVisible(sessionId, true);
		progressDisplayVisible.value = false;
	};

	const cancelProgressTask = (sourceId: string, taskId: string) =>
		sourceId === 'server-transfers'
			? serverTransfers.cancel(taskId)
			: registry.sessions.get(sourceId)?.transferController.cancel(taskId);

	const cancelProgressSource = (sourceId: string) =>
		sourceId === 'server-transfers'
			? serverTransfers.cancelAll()
			: registry.sessions.get(sourceId)?.transferController.cancelAll();

	const removeProgressTask = (sourceId: string, taskId: string) => {
		if (sourceId === 'server-transfers') {
			void serverTransfers
				.remove(taskId)
				.catch((cause) => feedback.notifyError(cause instanceof Error ? cause.message : String(cause)));
			return;
		}
		const controller = registry.sessions.get(sourceId)?.transferController;
		if (!controller) return;
		controller.remove(taskId);
	};

	const parentPath = (path: string): string => {
		const normalized = path.replace(/\/+$/, '') || '/';
		const index = normalized.lastIndexOf('/');
		return index <= 0 ? '/' : normalized.slice(0, index);
	};

	const setFileClipboard = (
		source: WorkspaceRuntimeSession,
		operation: FileClipboardOperation,
		entries: RemoteFileEntry[],
	) => {
		registry.fileClipboard.set(
			operation,
			source.id,
			entries.map((entry) => ({
				path: entry.path,
				name: entry.name,
				type: entry.metadata.isDirectory ? 'directory' : 'file',
			})),
		);
	};

	const pasteFileClipboard = async (target: WorkspaceRuntimeSession, destination: string) => {
		const snapshot = registry.fileClipboard.value.value;
		const targetPath = destination;
		if (!snapshot || !targetPath.startsWith('/')) return;

		const source = registry.sessions.get(snapshot.sourceScopeId);
		if (!source || source.state.value !== 'connected') {
			feedback.notifyError(t('fileManager.errors.sourceSessionNotReady'));
			return;
		}

		const sameSession = source.id === target.id;
		if (
			snapshot.operation === 'cut' &&
			sameSession &&
			snapshot.items.every((item) => parentPath(item.path) === targetPath)
		) {
			feedback.notifyWarning(t('fileManager.warnings.moveSameDirectory'));
			return;
		}

		const permission = pageScope.signal;

		const current = () =>
			isPageCurrent(permission) &&
			registry.sessions.get(source.id) === source &&
			registry.sessions.get(target.id) === target &&
			source.state.value === 'connected' &&
			target.state.value === 'connected';

		try {
			if (source.connection.id !== target.connection.id) {
				if (
					!(await confirmTransferCredentials(permission)) ||
					!current() ||
					registry.fileClipboard.value.value?.generation !== snapshot.generation
				)
					return;
				if (target.connection.route === 'direct') {
					const preparation = new AbortController();
					const stopWatching = watch(
						() => current() && registry.fileClipboard.value.value?.generation === snapshot.generation,
						(valid) => {
							if (!valid) {
								preparation.abort();
							}
						},
						{ flush: 'sync' },
					);
					try {
						if (
							!(await clipboardTools.prepareTransfer(
								{
									sourceId: source.connection.id,
									targetIds: [target.connection.id],
									method: 'auto',
									directories: snapshot.items.some((item) => item.type === 'directory'),
								},
								AbortSignal.any([permission, preparation.signal]),
							))
						) {
							return;
						}
					} finally {
						stopWatching();
					}
				}
			}
			if (!current() || registry.fileClipboard.value.value?.generation !== snapshot.generation) return;
			const taskId = await target.transferController.copyMove({
				kind: snapshot.operation === 'cut' ? 'move' : 'copy',
				sources: snapshot.items.map((item) => ({ scopeId: source.id, path: item.path })),
				destination: { scopeId: target.id, path: targetPath },
			});

			const task = await target.transferController.waitForTask(taskId);
			if (!current()) return;
			if (task.status === 'error' || task.status === 'unknown') {
				feedback.notifyError(
					task.error || task.errorKind
						? transferErrorMessage(task)
						: t(
								snapshot.operation === 'cut'
									? 'fileManager.errors.moveFailed'
									: 'fileManager.errors.copyFailed',
							),
				);
				return;
			}
			if (task.status !== 'completed' && task.status !== 'partial') return;
			const warning = transferTaskWarningDescriptor(task);
			if (warning) feedback.notifyWarning(t(warning.key, warning.params ?? {}));
			if (snapshot.operation === 'cut' && task.status === 'completed')
				registry.fileClipboard.clear(snapshot.generation);
			// Refresh is a read after the confirmed mutation; its failure must not suggest replaying the move.
			const refreshes = [target.filesystemState.browser.refresh()];
			if (!sameSession && snapshot.operation === 'cut') refreshes.push(source.filesystemState.browser.refresh());
			const refreshed = await Promise.allSettled(refreshes);
			if (refreshed.some((result) => result.status === 'rejected'))
				feedback.notifyWarning(t('fileManager.warnings.transferRefreshFailed'));
		} catch (cause) {
			if (!current()) return;
			feedback.notifyError(
				t(
					cause instanceof TransferFailure && cause.outcomeUnknown
						? 'progressCenter.error.transferUnknown'
						: 'progressCenter.error.transferFailed',
				),
			);
		}
	};

	const terminalTheme = computed(() => {
		const id = appearanceSettings.value.activeTerminalThemeId;
		return appearanceThemes.value.find((theme) => theme.id === id)?.themeData ?? defaultTerminalTheme;
	});

	const terminalVisual = computed(() => ({
		backgroundEnabled: appearanceSettings.value.terminalBackgroundEnabled,
		backgroundImageUrl: appearanceSettings.value.terminalBackgroundImage ?? undefined,
		backgroundOverlayOpacity: appearanceSettings.value.terminalBackgroundOverlayOpacity,
		customHtml: appearanceSettings.value.terminalCustomHtml,
		textStroke: {
			enabled: Boolean(appearanceSettings.value.terminalTextStrokeEnabled),
			width: appearanceSettings.value.terminalTextStrokeWidth ?? 0,
			color: appearanceSettings.value.terminalTextStrokeColor ?? '#000000',
		},
		textShadow: {
			enabled: Boolean(appearanceSettings.value.terminalTextShadowEnabled),
			offsetX: appearanceSettings.value.terminalTextShadowOffsetX ?? 0,
			offsetY: appearanceSettings.value.terminalTextShadowOffsetY ?? 0,
			blur: appearanceSettings.value.terminalTextShadowBlur ?? 0,
			color: appearanceSettings.value.terminalTextShadowColor ?? '#000000',
		},
	}));
	const terminalScrollback = computed(() =>
		terminalScrollbackForRuntime(preferences.values.value.terminalScrollbackLimit),
	);
	const terminalFontSize = computed(
		() =>
			terminalFontPreview.value ??
			(device.isMobile.value
				? (appearanceSettings.value.terminalFontSizeMobile ?? appearanceSettings.value.terminalFontSize)
				: appearanceSettings.value.terminalFontSize),
	);
	const fileManagerRowScale = computed(
		() => fileManagerRowScalePreview.value ?? preferences.values.value.fileManagerRowSizeMultiplier,
	);

	const setSurface = (id: string, value: unknown) => {
		if (value) surfaces.set(id, value as SurfaceApi);
		else surfaces.delete(id);
	};

	const openConnection = async (connection: ConnectionSummary): Promise<void> => {
		const signal = pageScope.signal;
		if (!isPageCurrent(signal)) return;
		if (connection.type === 'RDP' || connection.type === 'VNC') {
			remoteDesktopLauncher.open({
				id: connection.id,
				name: connection.name || connection.host,
				type: connection.type,
			});
			return;
		}
		connectionPickerVisible.value = false;
		try {
			await registry.open(connection);
		} catch (cause) {
			if (!isPageCurrent(signal) || (cause instanceof DOMException && cause.name === 'AbortError')) return;
			feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const openConnections = async (connections: ConnectionSummary[]) => {
		const signal = pageScope.signal;
		for (const connection of connections) {
			if (!isPageCurrent(signal)) return;
			await openConnection(connection);
		}
	};

	const sendCommand = async (source: WorkspaceRuntimeSession, command: string, allSessions: boolean) => {
		const signal = pageScope.signal;

		const isCurrent = () => isPageCurrent(signal) && registry.sessions.get(source.id) === source;

		if (!isCurrent()) return;
		const value = command.replace(/[\r\n]+$/, '');
		const targets = allSessions ? registry.orderedSessions.value : [source];
		if (value === '') {
			for (const session of targets) {
				if (!isCurrent()) return;
				if (registry.sessions.get(session.id) !== session) continue;
				if (session.state.value === 'connected') await session.adapters.terminal.sendInput('\r');
				else session.reconnectNow();
				if (!isCurrent() || registry.sessions.get(session.id) !== session) return;
				surfaces.get(session.id)?.scrollTerminalToBottom?.();
			}
			return;
		}
		const activeTargets = targets.filter((session) => session.state.value === 'connected');
		const payload = value === '\x03' ? value : `${value}\r`;
		const results = await Promise.allSettled(
			activeTargets.map((session) => session.adapters.terminal.sendInput(payload)),
		);
		if (!isCurrent()) return;
		for (const [index, session] of activeTargets.entries()) {
			if (results[index]?.status === 'fulfilled' && registry.sessions.get(session.id) === session) {
				surfaces.get(session.id)?.scrollTerminalToBottom?.();
			}
		}
		if (allSessions) {
			if (activeTargets.length > 0) {
				feedback.notifySuccess(
					t('quickCommands.notifications.sentToAllSessions', { count: activeTargets.length }),
				);
			} else {
				feedback.notifyInfo(t('quickCommands.notifications.noActiveSshSessions'));
			}
		}
		const sentToSource = !allSessions && activeTargets[0]?.id === source.id && results[0]?.status === 'fulfilled';
		if (value !== '\x03' && sentToSource) {
			try {
				await history.add(value, signal);
			} catch (cause) {
				if (!isCurrent()) return;
				feedback.notifyError(
					t('commandHistory.addFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
				);
			}
		}
	};

	const preparingSessionId = ref<string | null>(null);
	let activationGeneration = 0;

	const activateSession = (id: string) => {
		const signal = pageScope.signal;
		const session = registry.sessions.get(id);
		if (!isPageCurrent(signal) || !session) return;

		const isCurrent = () => isPageCurrent(signal) && registry.sessions.get(id) === session;

		connectionPickerVisible.value = false;
		const generation = ++activationGeneration;
		if (id === registry.activeId.value) {
			preparingSessionId.value = null;
			void nextTick(() => {
				if (!isCurrent() || generation !== activationGeneration) return;
				surfaces.get(id)?.fitTerminal?.();
				surfaces.get(id)?.focusTerminal?.();
			});
			return;
		}

		// Inactive surfaces stay laid out but invisible. Fit xterm while the target has real
		// geometry, then make it active on the next animation frame so the pane never reflows.
		preparingSessionId.value = id;
		void nextTick(() => {
			if (!isCurrent() || generation !== activationGeneration || preparingSessionId.value !== id) return;
			surfaces.get(id)?.prepareTerminal?.();
			window.requestAnimationFrame(() => {
				if (!isCurrent() || generation !== activationGeneration || preparingSessionId.value !== id) return;
				registry.activate(id);
				preparingSessionId.value = null;
				void nextTick(() => {
					if (!isCurrent() || generation !== activationGeneration) return;
					surfaces.get(id)?.fitTerminal?.();
					surfaces.get(id)?.focusTerminal?.();
				});
			});
		});
	};

	const flushWorkspacePresentation = () =>
		Promise.all([
			terminalFontSaver.flush(),
			editorFontSaver.flush(),
			fileManagerRowScaleSaver.flush(),
			quickCommandRowScaleSaver.flush(),
		]);

	const closeSession = async (id: string) => {
		const flushed = flushWorkspacePresentation();
		const next = { ...progressVisibility.value };
		delete next[id];
		progressVisibility.value = next;
		registry.remove(id);
		await flushed;
	};

	const resettingSessions = new Set<string>();

	const resetSession = async (id: string): Promise<void> => {
		const signal = pageScope.signal;
		const session = registry.sessions.get(id);
		if (!isPageCurrent(signal) || !session?.canResetTerminal || resettingSessions.has(id)) return;
		resettingSessions.add(id);
		try {
			const accepted = await feedback.confirm({
				message: t('workspace.terminal.confirmReset', { name: session.connection.name }),
				signal,
			});
			if (!accepted || !isPageCurrent(signal) || registry.sessions.get(id) !== session) return;
			await flushWorkspacePresentation();
			if (!isPageCurrent(signal) || registry.sessions.get(id) !== session) return;
			const outcome = await registry.reset(id, signal);
			if (!isPageCurrent(signal)) return;
			if (outcome === 'close_unconfirmed') feedback.notifyError(t('workspace.terminal.resetCloseUnconfirmed'));
			else if (outcome === 'unavailable') feedback.notifyError(t('workspace.terminal.resetUnavailable'));
		} catch (cause) {
			logger.error({ err: cause, workspaceId: id }, 'Workspace terminal reset failed');
			if (isPageCurrent(signal)) feedback.notifyError(t('workspace.terminal.resetFailed'));
		} finally {
			resettingSessions.delete(id);
			if (!registry.sessions.has(id)) {
				const next = { ...progressVisibility.value };
				delete next[id];
				progressVisibility.value = next;
			}
		}
	};

	const closeOtherSessions = async (id: string) => {
		const flushed = flushWorkspacePresentation();
		registry.closeOthers(id);
		await flushed;
	};

	const closeSessionsToRight = async (id: string) => {
		const flushed = flushWorkspacePresentation();
		registry.closeToRight(id);
		await flushed;
	};

	const closeSessionsToLeft = async (id: string) => {
		const flushed = flushWorkspacePresentation();
		registry.closeToLeft(id);
		await flushed;
	};

	const toggleSuspendMark = async (id: string, intent: 'toggle' | 'unmark' = 'toggle') => {
		const signal = pageScope.signal;
		if (!isPageCurrent(signal)) return;
		const session = registry.sessions.get(id);
		if (!session) {
			logger.debug(
				{ workspaceId: id, failureKind: 'workspace_runtime_not_found' },
				'Workspace suspend toggle ignored because runtime was not found',
			);
			return;
		}

		const isCurrent = () => isPageCurrent(signal) && registry.sessions.get(id) === session;

		const unmarking = session.markedForSuspend.value;
		if (intent === 'unmark' && !unmarking) return;
		try {
			if (unmarking) {
				await session.unmarkSuspend();
				if (!isCurrent()) return;
				await refreshSuspendedSessionsCatalog();
				if (!isCurrent()) return;
				feedback.notifySuccess(t('sshSuspend.notifications.unmarkedSuccess', { id }));
				return;
			}
			const surface = surfaces.get(id);
			const snapshot =
				surface?.terminalSnapshot?.bind(surface) ?? (async () => session.terminalState.snapshot.value);
			const suspendedSessionId = await session.markForSuspend(snapshot);
			if (!isCurrent()) return;
			await refreshSuspendedSessionsCatalog();
			if (!isCurrent()) return;
			logger.debug({ workspaceId: id, suspendedSessionId }, 'Workspace marked for suspend while attached');
			feedback.notifySuccess(t('sshSuspend.notifications.markedForSuspendSuccess', { id }));
		} catch (cause) {
			if (!isCurrent()) return;
			const message = cause instanceof Error ? cause.message : String(cause);
			feedback.notifyError(
				unmarking
					? t('sshSuspend.notifications.unmarkError', { error: message })
					: t('sshSuspend.notifications.markForSuspendError', { error: message }),
			);
		}
	};

	const unmarkSuspended = (id: string) => toggleSuspendMark(id, 'unmark');

	const resumeSuspended = async (
		suspended: SuspendedSession,
		options: { silent?: boolean } = {},
	): Promise<boolean> => {
		const signal = pageScope.signal;
		// Backend originalWorkspaceId is immutable across resumes, but the
		// mounted Workspace ID changes on each resume. Use the known suspension
		// ID to locate the current runtime rather than opening a duplicate tab.
		const replacement =
			registry.orderedSessions.value.find(
				(session) => session.markedForSuspend.value && session.associatedSuspendedSessionId === suspended.id,
			) ?? registry.sessions.get(suspended.originalWorkspaceId);

		const isCurrent = () =>
			isPageCurrent(signal) && (!replacement || registry.sessions.get(replacement.id) === replacement);

		if (!isCurrent()) return false;
		try {
			const takeover = suspended.ownershipState !== 'available';
			if (takeover) {
				if (options.silent) return false;
				const name = suspended.customName ?? suspended.connectionName;
				if (!(await feedback.confirm({ message: t('sshSuspend.prompts.confirmTakeover', { name }), signal })))
					return false;
			}
			if (!isCurrent()) return false;
			const shouldReplace =
				replacement &&
				replacement.markedForSuspend.value &&
				(replacement.state.value === 'disconnected' || replacement.state.value === 'error');
			const connection = shouldReplace ? replacement.connection : await refreshConnection(suspended.connectionId);
			if (!isCurrent()) return false;
			if (connection.type !== 'SSH') throw new Error(t('workspace.errors.suspendedConnectionNotSsh'));
			if (shouldReplace) await registry.resumeReplacing(suspended, connection, replacement.id, { takeover });
			else await registry.resume(suspended, connection, { takeover });
			if (!isPageCurrent(signal)) return false;
			if (!options.silent) {
				connectionPickerVisible.value = false;
				suspendedVisible.value = false;
				feedback.notifySuccess(
					t('sshSuspend.notifications.resumeSuccess', {
						name: suspended.customName ?? suspended.connectionName,
					}),
				);
			}
			return true;
		} catch (cause) {
			if (!isPageCurrent(signal)) return false;
			logger.debug(
				{
					err: cause,
					suspendedSessionId: suspended.id,
					originalWorkspaceId: suspended.originalWorkspaceId,
					connectionId: suspended.connectionId,
					silent: Boolean(options.silent),
					failureKind: 'suspended_resume_failed',
				},
				'Workspace suspended-session resume failed in view',
			);
			if (!options.silent) feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};

	const resumeMarkedSession = async (workspaceId: string) => {
		const signal = pageScope.signal;
		if (!isPageCurrent(signal)) return;
		const session = registry.sessions.get(workspaceId);
		if (!session) {
			logger.debug(
				{ workspaceId, failureKind: 'workspace_runtime_not_found' },
				'Marked Workspace resume ignored because runtime was not found',
			);
			return;
		}
		if (!session.markedForSuspend.value) {
			logger.debug(
				{ workspaceId, state: session.state.value, failureKind: 'workspace_not_marked_for_suspend' },
				'Marked Workspace resume ignored because runtime is not marked for suspend',
			);
			return;
		}
		if (session.state.value === 'connected') {
			registry.activate(workspaceId);
			connectionPickerVisible.value = false;
			suspendedVisible.value = false;
			return;
		}
		const refreshed = await refreshSuspendedSessionsCatalog();
		if (!isPageCurrent(signal) || registry.sessions.get(workspaceId) !== session) return;
		if (!refreshed.ok) {
			logger.debug(
				{ workspaceId, status: refreshed.status, failureKind: 'suspended_catalog_refresh_failed' },
				'Marked Workspace resume stopped because suspended catalog refresh failed',
			);
			return;
		}
		const suspended =
			(session.associatedSuspendedSessionId && findSuspendedSessionById(session.associatedSuspendedSessionId)) ||
			findSuspendedSessionByOriginalWorkspace(workspaceId);
		if (!suspended) {
			logger.debug(
				{
					workspaceId,
					connectionId: session.connection.id,
					state: session.state.value,
					failureKind: 'suspended_session_not_found',
				},
				'Marked Workspace could not find a matching suspended session',
			);
			return;
		}
		await resumeSuspended(suspended);
	};

	const reconcileDisconnectedWorkspaceSessions = (options: { kickOrdinary?: boolean } = {}): Promise<void> => {
		const signal = pageScope.signal;
		if (!isPageCurrent(signal) || document.visibilityState !== 'visible') return Promise.resolve();

		if (options.kickOrdinary) {
			for (const session of registry.orderedSessions.value) {
				if (
					!session.markedForSuspend.value &&
					(session.state.value === 'disconnected' ||
						session.state.value === 'error' ||
						session.state.value === 'reconnecting')
				) {
					session.reconnectNow({ automatic: true });
				}
			}
		}

		if (sessionReconcilePromise) {
			sessionReconcileRequested = true;
			return sessionReconcilePromise;
		}
		sessionReconcileRequested = false;
		const task = (async () => {
			const candidates = new Map(
				registry.orderedSessions.value
					.filter(
						(session) =>
							session.markedForSuspend.value &&
							session.state.value !== 'connected' &&
							session.state.value !== 'connecting',
					)
					.map((session) => [session.id, session]),
			);
			if (!candidates.size) return;

			for (let attempt = 0; attempt < SESSION_RECONCILE_ATTEMPTS && candidates.size; attempt += 1) {
				if (!isPageCurrent(signal) || document.visibilityState !== 'visible') return;
				for (const workspaceId of [...candidates.keys()]) {
					const session = registry.sessions.get(workspaceId);
					if (
						session !== candidates.get(workspaceId) ||
						!session?.markedForSuspend.value ||
						session.state.value === 'connected' ||
						session.state.value === 'connecting'
					) {
						candidates.delete(workspaceId);
					}
				}
				if (!candidates.size) break;

				const refreshed = await refreshSuspendedSessionsCatalog();
				if (!isPageCurrent(signal) || document.visibilityState !== 'visible') return;
				if (refreshed.ok) {
					for (const workspaceId of [...candidates.keys()]) {
						if (!isPageCurrent(signal)) return;
						const session = candidates.get(workspaceId);
						if (!session || registry.sessions.get(workspaceId) !== session) {
							candidates.delete(workspaceId);
							continue;
						}
						const suspended =
							(session.associatedSuspendedSessionId &&
								findSuspendedSessionById(session.associatedSuspendedSessionId)) ||
							findSuspendedSessionByOriginalWorkspace(workspaceId);
						if (!suspended) continue;
						if (suspended.ownershipState !== 'available') {
							if (suspended.attachedWorkspaceId && suspended.attachedWorkspaceId !== workspaceId) {
								logger.debug(
									{
										workspaceId,
										suspendedSessionId: suspended.id,
										attachedWorkspaceId: suspended.attachedWorkspaceId,
										ownershipState: suspended.ownershipState,
									},
									'Marked Workspace reconciliation deferred to authoritative backend owner',
								);
								candidates.delete(workspaceId);
							}
							continue;
						}
						if (await resumeSuspended(suspended, { silent: true })) candidates.delete(workspaceId);
					}
				}

				if (candidates.size && attempt + 1 < SESSION_RECONCILE_ATTEMPTS) {
					await waitForReconciliation(signal);
				}
			}

			if (!isPageCurrent(signal)) return;
			for (const workspaceId of candidates.keys()) {
				const session = registry.sessions.get(workspaceId);
				if (!session?.markedForSuspend.value) continue;
				logger.debug(
					{
						workspaceId,
						connectionId: session.connection.id,
						state: session.state.value,
						failureKind: 'suspended_backend_state_pending',
					},
					'Marked Workspace remains disconnected until backend suspended state becomes recoverable',
				);
			}
		})().finally(() => {
			if (sessionReconcilePromise !== task) return;
			sessionReconcilePromise = null;
			if (sessionReconcileRequested && isPageCurrent(signal)) {
				sessionReconcileRequested = false;
				void reconcileDisconnectedWorkspaceSessions();
			}
		});
		sessionReconcilePromise = task;
		return task;
	};

	watch(
		() =>
			registry.orderedSessions.value.map((session) => ({
				id: session.id,
				marked: session.markedForSuspend.value,
				state: session.state.value,
			})),
		(states) => {
			if (
				states.some(
					(session) => session.marked && session.state !== 'connected' && session.state !== 'connecting',
				)
			) {
				void reconcileDisconnectedWorkspaceSessions();
			}
		},
	);

	const handleDocumentVisibilityChange = () => {
		if (document.visibilityState !== 'visible') {
			cancelViewportSync();
			return;
		}
		cancelViewportSync();
		scheduleViewportSync();
		void recoverForegroundSessions();
	};

	const recoverForegroundSessions = async () => {
		if (!workspaceActive || document.visibilityState !== 'visible') return;
		const signal = pageScope.signal;
		await Promise.all(registry.orderedSessions.value.map((session) => session.recoverForeground()));
		if (!isPageCurrent(signal) || document.visibilityState !== 'visible') return;
		await reconcileDisconnectedWorkspaceSessions({ kickOrdinary: true });
	};

	const handleBrowserOnline = () => {
		if (document.visibilityState === 'visible') void recoverForegroundSessions();
	};

	const saveSidebarWidth = (pane: string, width: string) => {
		void preferences
			.update(
				{ sidebarPaneWidths: { ...preferences.values.value.sidebarPaneWidths, [pane]: width } },
				preferences.version.value,
				pageScope.signal,
			)
			.catch(reportPreferenceSaveError);
	};

	const updateQuickCommandCompactMode = (compact: boolean) => {
		void preferences
			.update({ quickCommandsCompactMode: compact }, preferences.version.value, pageScope.signal)
			.catch(reportPreferenceSaveError);
	};

	const updateLayoutLocked = async (locked: boolean) => {
		try {
			await preferences.saveWorkspacePreference('layoutLocked', locked, pageScope.signal);
		} catch {
			feedback.notifyError(t('layoutConfigurator.lockUpdateError'));
		}
	};

	const toggleHeader = async () => {
		await preferences.saveWorkspacePreference(
			'navBarVisible',
			!preferences.values.value.navBarVisible,
			pageScope.signal,
		);
	};

	const refreshWorkspaceSettings = async (): Promise<void> => {
		const signal = pageScope.signal;
		try {
			await workspaceLayout.load(true);
			if (!isPageCurrent(signal)) return;
			await workspaceFocus.load(true);
		} catch (cause) {
			if (isPageCurrent(signal)) feedback.notifyError(preferenceFailureMessage(cause, t));
		}
	};

	watch(workspaceLayout.error, (cause) => {
		if (!cause || !isPageCurrent(pageScope.signal) || isNetworkFailure(cause)) return;
		feedback.notifyError(preferenceFailureMessage(cause, t), 0, {
			key: 'workspace-layout',
			label: t('common.refresh'),

			disabled: () => workspaceLayout.loading.value || !isPageCurrent(pageScope.signal),

			onClick: () => {
				void refreshWorkspaceSettings();
			},
		});
	});

	const loadQueryActions = async () => {
		const signal = pageScope.signal;
		if (!isPageCurrent(signal)) return;
		const raw = route.query.connectionId;
		const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
			.map((value) => Number(value))
			.filter((id) => Number.isInteger(id) && id > 0);
		const rawOpenSuspended = Array.isArray(route.query.openSuspended)
			? route.query.openSuspended[0]
			: route.query.openSuspended;
		const shouldOpenSuspended = rawOpenSuspended === '1' || rawOpenSuspended === 'true';
		if (!values.length && !shouldOpenSuspended) return;

		// Consume one-shot query actions before starting any potentially slow connection work.
		// ConnectionSummary success must never perform a later navigation: if the user returns to the
		// connections while SSH is still connecting, the background completion should stay there.
		try {
			await router.replace({ name: 'Workspace', query: {} });
			for (const id of [...new Set(values)]) {
				if (!isPageCurrent(signal)) return;
				const connection = await refreshConnection(id);
				if (!isPageCurrent(signal)) return;
				await openConnection(connection);
			}
			if (isPageCurrent(signal) && shouldOpenSuspended) suspendedVisible.value = true;
		} catch (cause) {
			if (isPageCurrent(signal)) feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const handleGlobalKeydown = (event: KeyboardEvent) => {
		if (!workspaceActive) return;
		if (event.key === 'Alt' && !event.repeat) {
			altCycleCandidate = true;
			return;
		}
		if (event.altKey) altCycleCandidate = false;
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			const ids = registry.orderedSessions.value.map((session) => session.id);
			if (ids.length < 2 || !registry.activeId.value) return;
			const index = ids.indexOf(registry.activeId.value);
			if (index < 0) return;
			event.preventDefault();
			event.stopPropagation();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			activateSession(ids[(index + delta + ids.length) % ids.length]!);
			return;
		}
		const pressed = normalizeShortcut(shortcutFromKeyboardEvent(event));
		if (!pressed) return;
		const target = Object.entries(workspaceFocus.config.value.shortcuts).find(
			([, config]) => config && normalizeShortcut(config) === pressed,
		)?.[0];
		if (target) {
			event.preventDefault();
			event.stopPropagation();
			void focusRegistry.focus(target);
		}
	};

	const handleGlobalKeyup = (event: KeyboardEvent) => {
		if (!workspaceActive) return;
		if (event.key !== 'Alt') return;
		if (altCycleCandidate) void focusRegistry.focusNext(workspaceFocus.config.value.sequence);
		altCycleCandidate = false;
	};

	const unregisterSessionReset = registerAuthenticatedSessionReset(`workspace-page-${crypto.randomUUID()}`, () => {
		workspaceActive = false;
		cancelViewportSync();
		revokePageActions();
	});

	onMounted(async () => {
		activatePageActions();
		const signal = pageScope.signal;
		if (route.query.connectionId) preloadWorkspaceTerminalSurface();
		window.addEventListener('keydown', handleGlobalKeydown, true);
		window.addEventListener('keyup', handleGlobalKeyup, true);
		document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
		window.addEventListener('online', handleBrowserOnline);
		window.addEventListener('pageshow', handleDocumentVisibilityChange);
		window.addEventListener('focus', scheduleViewportSync);
		window.visualViewport?.addEventListener('resize', scheduleViewportSync);
		window.visualViewport?.addEventListener('scroll', scheduleViewportSync);
		scheduleViewportSync();
		stopServerTransferPolling = serverTransfers.startPolling();
		// The layout is needed before mounting a terminal; the remaining settings can settle while
		// the provisional session connects. Appearance changes are reactive, including its background.
		const layoutLoad = workspaceLayout.load();
		void Promise.allSettled([workspaceFocus.load(), appearance.load(), history.load()]);
		void preferences.load().catch((cause) => {
			if (isPageCurrent(signal)) feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
		});
		await layoutLoad.catch((cause) => {
			if (isPageCurrent(signal)) feedback.notifyError(preferenceFailureMessage(cause, t));
		});
		if (!isPageCurrent(signal)) return;
		await loadQueryActions();
		if (isPageCurrent(signal) && document.visibilityState === 'visible') {
			void recoverForegroundSessions();
		}
	});
	let initialActivation = true;
	onActivated(async () => {
		activatePageActions();
		workspaceVisible.value = true;
		scheduleViewportSync();
		if (initialActivation) {
			initialActivation = false;
			return;
		}
		const permission = pageScope.signal;
		if (!workspaceLayout.loaded.value) {
			const signal = pageScope.signal;
			await Promise.all([workspaceLayout.load(), workspaceFocus.load()]).catch((cause) => {
				if (isPageCurrent(signal)) feedback.notifyError(preferenceFailureMessage(cause, t));
			});
		}
		if (!isPageCurrent(permission)) return;
		stopServerTransferPolling ??= serverTransfers.startPolling();
		const signal = pageScope.signal;
		const id = registry.activeId.value;
		void nextTick(() => {
			if (isPageCurrent(signal) && id === registry.activeId.value) surfaces.get(id ?? '')?.fitTerminal?.();
		});
		void loadQueryActions();
		void recoverForegroundSessions();
	});
	onDeactivated(() => {
		workspaceActive = false;
		cancelViewportSync();
		revokePageActions();
		workspaceVisible.value = false;
		altCycleCandidate = false;
		stopServerTransferPolling?.();
		stopServerTransferPolling = undefined;
		suspendedVisible.value = false;
		layoutConfiguratorVisible.value = false;
		focusConfiguratorVisible.value = false;
		progressDisplayVisible.value = false;
		void flushWorkspacePresentation();
	});
	onBeforeUnmount(() => {
		workspaceActive = false;
		cancelViewportSync();
		revokePageActions();
		unregisterSessionReset();
		void workspaceLayout.dispose();
		window.removeEventListener('keydown', handleGlobalKeydown, true);
		window.removeEventListener('keyup', handleGlobalKeyup, true);
		window.removeEventListener('online', handleBrowserOnline);
		window.removeEventListener('pageshow', handleDocumentVisibilityChange);
		window.removeEventListener('focus', scheduleViewportSync);
		window.visualViewport?.removeEventListener('resize', scheduleViewportSync);
		window.visualViewport?.removeEventListener('scroll', scheduleViewportSync);
		document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
		stopServerTransferPolling?.();
		void statusScaleSaver.dispose({ flush: true });
		void fileManagerRowScaleSaver.dispose({ flush: true });
		void quickCommandRowScaleSaver.dispose({ flush: true });
		void terminalFontSaver.dispose({ flush: true });
		void editorFontSaver.dispose({ flush: true });
		void mobileEditorFontSaver.dispose({ flush: true });
	});
</script>

<template>
	<main
		ref="viewportRoot"
		:style="visibleWorkspaceHeight === undefined ? undefined : { maxHeight: `${visibleWorkspaceHeight}px` }"
		class="flex min-h-0 flex-col overflow-hidden bg-background"
		:class="preferences.values.value.navBarVisible ? 'h-[calc(100dvh-var(--app-header-height))]' : 'h-dvh'"
	>
		<RemoteToolInstallDialog
			:offer="clipboardTools.offer.value"
			:busy="clipboardTools.busy.value"
			:allow-fallback="clipboardTools.allowFallback.value"
			:target-name="clipboardToolTargetName"
			@approve="clipboardTools.approve"
			@cancel="clipboardTools.cancel"
		/>
		<WorkspaceTabBar
			:sessions="registry.orderedSessions.value"
			:active-id="registry.activeId.value"
			:mobile="device.isMobile.value"
			:nav-bar-visible="preferences.values.value.navBarVisible"
			:show-workspace-suspended-sessions="preferences.values.value.showWorkspaceSuspendedSessions"
			:show-workspace-header-toggle="preferences.values.value.showWorkspaceHeaderToggle"
			:show-workspace-progress="preferences.values.value.showWorkspaceProgress"
			:show-workspace-layout-configurator="preferences.values.value.showWorkspaceLayoutConfigurator"
			@activate="activateSession"
			@close="closeSession"
			@reset="resetSession"
			@close-others="closeOtherSessions"
			@close-right="closeSessionsToRight"
			@close-left="closeSessionsToLeft"
			@toggle-suspend="toggleSuspendMark"
			@reorder="registry.move"
			@new-session="connectionPickerVisible = true"
			@toggle-header="toggleHeader"
			@open-progress="progressDisplayVisible = true"
			@open-layout-configurator="layoutConfiguratorVisible = true"
			@open-suspended="
				suspendedVisible = !connectionPickerVisible && Boolean(registry.orderedSessions.value.length)
			"
		/>

		<ProgressDisplayModal
			v-if="progressDisplayVisible"
			:visible="true"
			:sources="progressDisplaySources"
			:server-transfers="serverTransfers.items.value"
			:server-transfers-loading="serverTransfers.loading.value"
			:mobile="device.isMobile.value"
			@close="progressDisplayVisible = false"
			@restore="restoreProgressSource"
			@cancel="cancelProgressTask"
			@cancel-all="cancelProgressSource"
			@remove="removeProgressTask"
		/>

		<WorkspaceStartPage
			v-if="!registry.orderedSessions.value.length || connectionPickerVisible"
			:mobile="device.isMobile.value"
			:marked-sessions="markedSuspendedSessions"
			:can-return="Boolean(registry.orderedSessions.value.length)"
			@open="openConnection"
			@open-many="openConnections"
			@resume="resumeSuspended"
			@resume-marked="resumeMarkedSession"
			@unmark="unmarkSuspended"
			@back="connectionPickerVisible = false"
		/>

		<div
			v-if="registry.orderedSessions.value.length && workspaceLayout.loaded.value"
			v-show="!connectionPickerVisible"
			class="relative min-h-0 flex-1"
			:class="
				device.isMobile.value
					? ''
					: 'mx-2 mb-2 mt-0 overflow-hidden rounded-b-md border border-t-0 border-border'
			"
		>
			<WorkspaceSessionSurface
				v-for="session in registry.orderedSessions.value"
				:visible="session.id === registry.activeId.value || session.id === preparingSessionId"
				:key="session.id"
				:ref="(value) => setSurface(session.id, value)"
				class="absolute inset-0"
				:class="
					session.id === preparingSessionId && session.id !== registry.activeId.value
						? 'invisible pointer-events-none'
						: ''
				"
				:aria-hidden="session.id !== registry.activeId.value"
				:active="workspaceVisible && session.id === registry.activeId.value"
				:session="session"
				:layout="workspaceLayout.tree.value"
				:sidebars="workspaceLayout.sidebars.value"
				:terminal-font-family="appearanceSettings.terminalFontFamily"
				:terminal-font-size="terminalFontSize"
				:terminal-theme="terminalTheme"
				:terminal-visual="terminalVisual"
				:terminal-scrollback="terminalScrollback"
				:right-click-copy-paste="preferences.values.value.terminalRightClickCopyPaste"
				:editor-font-family="appearanceSettings.editorFontFamily ?? undefined"
				:editor-font-size="appearanceSettings.editorFontSize"
				:mobile-editor-font-size="appearanceSettings.mobileEditorFontSize"
				:command-input-sync-target="preferences.values.value.commandInputSyncTarget"
				:docker-interval-seconds="preferences.values.value.dockerStatusIntervalSeconds"
				:docker-default-expand="preferences.values.value.dockerDefaultExpand"
				:status-scale="statusScalePreview ?? preferences.values.value.statusMonitorScale"
				:status-show-ip="preferences.values.value.showStatusMonitorIpAddress"
				:mobile="device.isMobile.value"
				:clipboard-count="clipboardCount"
				:shared-editor-session="
					preferences.values.value.shareFileEditorTabs ? registry.sharedEditorSession : undefined
				"
				:show-popup-file-editor="preferences.values.value.showPopupFileEditor"
				:show-popup-file-manager="preferences.values.value.showPopupFileManager"
				:file-manager-confirm-delete="preferences.values.value.fileManagerShowDeleteConfirmation"
				:quick-commands-collapsible-search="preferences.values.value.quickCommandsCollapsibleSearch"
				:quick-commands-compact-mode="preferences.values.value.quickCommandsCompactMode"
				:show-connection-tags="preferences.values.value.showConnectionTags"
				:show-quick-command-tags="preferences.values.value.showQuickCommandTags"
				:sidebar-pane-widths="preferences.values.value.sidebarPaneWidths"
				:sidebar-persistent="preferences.values.value.workspaceSidebarPersistent"
				:file-manager-row-scale="fileManagerRowScale"
				:file-manager-column-widths="preferences.values.value.fileManagerColWidths"
				:spreadsheet-rows-per-page="preferences.values.value.spreadsheetPreviewRowsPerPage"
				:spreadsheet-max-columns="preferences.values.value.spreadsheetPreviewMaxColumns"
				:quick-command-row-scale="
					quickCommandScalePreview ?? preferences.values.value.quickCommandRowSizeMultiplier
				"
				:progress-visible="progressVisibility[session.id] !== false"
				:marked-suspended-sessions="markedSuspendedSessions"
				:layout-locked="preferences.values.value.layoutLocked"
				@layout-resize="workspaceLayout.updateNodeSizes"
				@open-connection="openConnection"
				@command="(command, all) => sendCommand(session, command, all)"
				@resume-suspended="resumeSuspended"
				@resume-marked-suspended="resumeMarkedSession"
				@unmark-suspended="unmarkSuspended"
				@file-clipboard-set="(operation, entries) => setFileClipboard(session, operation, entries)"
				@file-clipboard-paste="(destination) => pasteFileClipboard(session, destination)"
				@server-transfer-started="progressDisplayVisible = true"
				@status-scale="scheduleStatusScale"
				@terminal-font-size="updateTerminalFontSize"
				@editor-font-size="updateEditorFontSize"
				@mobile-editor-font-size="updateMobileEditorFontSize"
				@file-manager-row-scale="updateFileManagerRowScale"
				@file-manager-column-widths="saveFileManagerColumnWidths"
				@quick-command-row-scale="scheduleQuickCommandScale"
				@quick-command-compact-mode="updateQuickCommandCompactMode"
				@progress-visible="setProgressVisible(session.id, $event)"
				@interaction="session.reconnectNow()"
				@open-suspended="suspendedVisible = true"
				@open-focus-configurator="focusConfiguratorVisible = true"
				@sidebar-width="saveSidebarWidth"
			/>
		</div>

		<WorkspaceLayoutConfigurator
			v-if="layoutConfiguratorVisible"
			:visible="true"
			:layout-locked="preferences.values.value.layoutLocked"
			@layout-locked="updateLayoutLocked"
			@close="layoutConfiguratorVisible = false"
		/>
		<WorkspaceFocusConfigurator
			v-if="focusConfiguratorVisible"
			:visible="true"
			@close="focusConfiguratorVisible = false"
		/>
		<SuspendedSessionsModal
			v-if="suspendedVisible && registry.orderedSessions.value.length && !connectionPickerVisible"
			:visible="true"
			:can-resume="true"
			:marked-sessions="markedSuspendedSessions"
			@close="suspendedVisible = false"
			@resume="resumeSuspended"
			@resume-marked="resumeMarkedSession"
			@unmark="unmarkSuspended"
		/>
	</main>
</template>
