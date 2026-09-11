<script setup lang="ts">
  import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser';
  import { createLatestValueSaver } from '@/foundation/async';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry, normalizeShortcut, shortcutFromKeyboardEvent } from '@/shared/focus/public';
  import { connectionService, type Connection } from '@/features/connections/public';
  import { terminalScrollbackForRuntime, usePreferences } from '@/features/preferences/public';
  import { defaultTerminalTheme, useAppearance } from '@/features/appearance/public';
  import { useCommandHistory } from '@/features/command-history/public';
  import { remoteDesktopLauncher } from '@/features/remote-desktop/public';
  import {
    loadProgressDisplayModal,
    useServerTransfers,
    type FileClipboardOperation,
    type ProgressSource,
  } from '@/features/transfers/public';
  import type { RemoteFileEntry } from '@/features/filesystem/public';
  import {
    loadSuspendedSessionsModal,
    loadSuspendedSessionsPanel,
    findSuspendedSessionByOriginalWorkspace,
    refreshSuspendedSessionsCatalog,
    type SuspendedSession,
  } from '@/features/ssh-suspend/public';
  import WorkspaceConnectionList from '../components/WorkspaceConnectionList.vue';
  import WorkspaceTabBar from '../components/WorkspaceTabBar.vue';
  import { workspaceLayout } from '../layout/workspaceLayout';
  import { workspaceFocus } from '../focus/workspaceFocus';
  import { workspaceRuntimeRegistry, type WorkspaceRuntimeSession } from '../session';

  const ProgressDisplayModal = defineAsyncComponent(loadProgressDisplayModal);
  const SuspendedSessionsModal = defineAsyncComponent(loadSuspendedSessionsModal);
  const SuspendedSessionsPanel = defineAsyncComponent(loadSuspendedSessionsPanel);
  const WorkspaceLayoutConfigurator = defineAsyncComponent(
    () => import('../components/WorkspaceLayoutConfigurator.vue'),
  );
  const WorkspaceFocusConfigurator = defineAsyncComponent(() => import('../components/WorkspaceFocusConfigurator.vue'));
  const WorkspaceSessionSurface = defineAsyncComponent(() => import('../components/WorkspaceSessionSurface.vue'));

  interface SurfaceApi {
    terminalSnapshot?: () => string;
    focusTerminal?: () => void;
    fitTerminal?: () => void;
    scrollTerminalToBottom?: () => void;
  }

  const route = useRoute();
  const router = useRouter();
  const { t } = useI18n();
  const feedback = useFeedback();
  const device = useDeviceCapabilities();
  const preferences = usePreferences();
  const appearance = useAppearance();
  const appearanceSettings = appearance.settings;
  const appearanceThemes = appearance.themes;
  const history = useCommandHistory();
  const serverTransfers = useServerTransfers();
  const registry = workspaceRuntimeRegistry;
  const FOREGROUND_RECOVERY_ATTEMPTS = 10;
  const FOREGROUND_RECOVERY_DELAY_MS = 400;
  let foregroundRecoveryPromise: Promise<void> | null = null;
  let wasDocumentHidden = false;
  let workspaceActive = false;
  watch(registry.suspendAutoTerminationNotice, (notice) => {
    if (!notice) return;
    const name =
      notice.name ?? `${t('sshSuspend.notifications.defaultSessionName')} ${notice.suspendedSessionId.slice(0, 8)}`;
    feedback.notifyWarning(t('sshSuspend.notifications.autoTerminated', { name, reason: notice.reason }));
  });
  const surfaces = new Map<string, SurfaceApi>();
  const opening = ref(false);
  const suspendedVisible = ref(false);
  const connectionPickerVisible = ref(false);
  const layoutConfiguratorVisible = ref(false);
  const progressDisplayVisible = ref(false);
  const terminalFontPreview = ref<number | null>(null);
  const fileManagerRowScalePreview = ref<number | null>(null);
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
  const statusScaleSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (scale) => preferences.update({ statusMonitorScale: scale }),
    onError: reportPreferenceSaveError,
  });
  const fileManagerRowScaleSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (scale) => preferences.update({ fileManagerRowSizeMultiplier: scale }),
    onPendingChange: (pending) => {
      if (!pending) fileManagerRowScalePreview.value = null;
    },
    onError: reportPreferenceSaveError,
  });
  const quickCommandRowScaleSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (scale) => preferences.update({ quickCommandRowSizeMultiplier: scale }),
    onError: reportPreferenceSaveError,
  });

  const terminalFontSaver = createLatestValueSaver<{ mobile: boolean; size: number }>({
    delayMs: 240,
    save: ({ mobile, size }) =>
      appearance.update(mobile ? { terminalFontSizeMobile: size } : { terminalFontSize: size }),
    onPendingChange: (pending) => {
      if (!pending) terminalFontPreview.value = null;
    },
    onError: (cause) => feedback.notifyError(cause instanceof Error ? cause.message : String(cause)),
  });
  const editorFontSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (size) => appearance.update({ editorFontSize: size }),
    onError: (cause) => feedback.notifyError(cause instanceof Error ? cause.message : String(cause)),
  });
  const mobileEditorFontSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (size) => appearance.update({ mobileEditorFontSize: size }),
    onError: (cause) => feedback.notifyError(cause instanceof Error ? cause.message : String(cause)),
  });
  const saveFileManagerColumnWidths = (widths: Record<string, number>) => {
    void preferences.update({ fileManagerColWidths: widths }).catch(reportPreferenceSaveError);
  };
  const updateTerminalFontSize = (size: number) => {
    terminalFontPreview.value = size;
    appearance.previewSettings(device.isMobile.value ? { terminalFontSizeMobile: size } : { terminalFontSize: size });
    terminalFontSaver.schedule({ mobile: device.isMobile.value, size });
  };
  const updateFileManagerRowScale = (scale: number) => {
    fileManagerRowScalePreview.value = scale;
    fileManagerRowScaleSaver.schedule(scale);
  };
  const updateEditorFontSize = (size: number) => {
    appearance.previewSettings({ editorFontSize: size });
    editorFontSaver.schedule(size);
  };
  const updateMobileEditorFontSize = (size: number) => {
    appearance.previewSettings({ mobileEditorFontSize: size });
    mobileEditorFontSaver.schedule(size);
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
          session.transferController.tasks.value.some((task) => task.status !== 'cancelled'),
      )
      .map((session) => ({
        id: session.id,
        label: session.connection.name || session.connection.host,
        tasks: session.transferController.tasks.value.filter((task) => task.status !== 'cancelled'),
      })),
  );
  const progressDisplaySources = hiddenProgressSources;
  const progressDisplayTaskCount = computed(
    () =>
      progressDisplaySources.value.reduce((count, source) => count + source.tasks.length, 0) +
      serverTransfers.progressTasks.value.length,
  );
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
    const targetPath = destination.trim();
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

    try {
      const taskId = await target.transferController.copyMove({
        kind: snapshot.operation === 'cut' && sameSession ? 'move' : 'copy',
        sources: snapshot.items.map((item) => ({ scopeId: source.id, path: item.path })),
        destination: { scopeId: target.id, path: targetPath },
      });

      const task = await target.transferController.waitForTask(taskId);
      if (task.status === 'error') {
        feedback.notifyError(
          task.error ??
            t(snapshot.operation === 'cut' ? 'fileManager.errors.moveFailed' : 'fileManager.errors.copyFailed'),
        );
        return;
      }
      if (task.status === 'completed' || task.status === 'partial') {
        await target.filesystemState.browser.refresh();
      }
      if (snapshot.operation === 'copy' || task.status !== 'completed') return;

      if (sameSession) {
        registry.fileClipboard.clear(snapshot.generation);
        return;
      }

      try {
        await source.adapters.filesystem.remove(snapshot.items.map((item) => item.path));
        registry.fileClipboard.clear(snapshot.generation);
        feedback.notifySuccess(t('fileManager.notifications.crossHostMoveSuccess'));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        target.transferController.markPartial(taskId, message);
        feedback.notifyWarning(t('fileManager.warnings.crossHostDeleteFailed', { error: message }));
      }
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const terminalTheme = computed(() => {
    const id = appearanceSettings.value.activeTerminalThemeId;
    return appearanceThemes.value.find((theme) => theme.id === id)?.themeData ?? defaultTerminalTheme;
  });

  const terminalVisual = computed(() => ({
    backgroundEnabled: appearanceSettings.value.terminalBackgroundEnabled,
    backgroundImageUrl: appearanceSettings.value.terminalBackgroundImage,
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

  const openConnection = async (connection: Connection): Promise<void> => {
    if (connection.type === 'RDP' || connection.type === 'VNC') {
      remoteDesktopLauncher.open({
        id: connection.id,
        name: connection.name || connection.host,
        type: connection.type,
      });
      return;
    }
    opening.value = true;
    try {
      await registry.open(connection);
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      opening.value = false;
    }
  };

  const openConnections = async (connections: Connection[]) => {
    for (const connection of connections) await openConnection(connection);
  };
  const openConnectionFromPicker = async (connection: Connection): Promise<void> => {
    connectionPickerVisible.value = false;
    await openConnection(connection);
  };
  const openConnectionsFromPicker = async (connections: Connection[]): Promise<void> => {
    connectionPickerVisible.value = false;
    await openConnections(connections);
  };

  const sendCommand = async (source: WorkspaceRuntimeSession, command: string, allSessions: boolean) => {
    const value = command.replace(/[\r\n]+$/, '');
    const targets = allSessions ? registry.orderedSessions.value : [source];
    if (value === '') {
      for (const session of targets) {
        if (session.state.value === 'connected') await session.adapters.terminal.sendInput('\r');
        else session.reconnectNow();
        surfaces.get(session.id)?.scrollTerminalToBottom?.();
      }
      return;
    }
    const activeTargets = targets.filter((session) => session.state.value === 'connected');
    const payload = value === '\x03' ? value : `${value}\r`;
    const results = await Promise.allSettled(
      activeTargets.map((session) => session.adapters.terminal.sendInput(payload)),
    );
    if (allSessions) {
      if (activeTargets.length > 0) {
        feedback.notifySuccess(t('quickCommands.notifications.sentToAllSessions', { count: activeTargets.length }));
      } else {
        feedback.notifyInfo(t('quickCommands.notifications.noActiveSshSessions'));
      }
    }
    const sentToSource = !allSessions && activeTargets[0]?.id === source.id && results[0]?.status === 'fulfilled';
    if (value !== '\x03' && sentToSource) {
      try {
        await history.add(value);
      } catch (cause) {
        feedback.notifyError(
          t('commandHistory.addFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
        );
      }
    }
  };

  const preparingSessionId = ref<string | null>(null);
  let activationGeneration = 0;
  const activateSession = (id: string) => {
    const generation = ++activationGeneration;
    if (id === registry.activeId.value) {
      preparingSessionId.value = null;
      void nextTick(() => {
        surfaces.get(id)?.fitTerminal?.();
        surfaces.get(id)?.focusTerminal?.();
      });
      return;
    }

    // v-show normally makes inactive surfaces display:none. Showing a terminal and only then
    // fitting xterm lets one frame escape with the stale viewport/canvas height, which appears
    // as a brief flash along the bottom edge. Pre-show the target invisibly, fit it while it has
    // real geometry, then make it active on the next animation frame.
    preparingSessionId.value = id;
    void nextTick(() => {
      if (generation !== activationGeneration || preparingSessionId.value !== id) return;
      surfaces.get(id)?.fitTerminal?.();
      window.requestAnimationFrame(() => {
        if (generation !== activationGeneration || preparingSessionId.value !== id) return;
        registry.activate(id);
        preparingSessionId.value = null;
        void nextTick(() => {
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
    await flushWorkspacePresentation();
    const next = { ...progressVisibility.value };
    delete next[id];
    progressVisibility.value = next;
    registry.remove(id);
  };
  const closeOtherSessions = async (id: string) => {
    await flushWorkspacePresentation();
    registry.closeOthers(id);
  };
  const closeSessionsToRight = async (id: string) => {
    await flushWorkspacePresentation();
    registry.closeToRight(id);
  };
  const closeSessionsToLeft = async (id: string) => {
    await flushWorkspacePresentation();
    registry.closeToLeft(id);
  };
  const toggleSuspendMark = async (id: string) => {
    const session = registry.sessions.get(id);
    if (!session) return;
    try {
      if (session.markedForSuspend.value) {
        await session.unmarkSuspend();
        feedback.notifySuccess(t('sshSuspend.notifications.unmarkedSuccess', { id }));
        return;
      }
      const snapshot = surfaces.get(id)?.terminalSnapshot?.() || session.terminalState.snapshot.value || undefined;
      await session.markForSuspend(snapshot);
      feedback.notifySuccess(t('sshSuspend.notifications.markedForSuspendSuccess', { id }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      feedback.notifyError(
        session.markedForSuspend.value
          ? t('sshSuspend.notifications.unmarkError', { error: message })
          : t('sshSuspend.notifications.markForSuspendError', { error: message }),
      );
    }
  };

  const resumeSuspended = async (suspended: SuspendedSession, options: { silent?: boolean } = {}): Promise<boolean> => {
    try {
      const replacement = registry.sessions.get(suspended.originalWorkspaceId);
      const shouldReplace = Boolean(
        replacement?.markedForSuspend.value &&
        (replacement.state.value === 'disconnected' || replacement.state.value === 'error'),
      );
      const connection = shouldReplace ? replacement!.connection : await connectionService.get(suspended.connectionId);
      if (connection.type !== 'SSH') throw new Error(t('workspace.errors.suspendedConnectionNotSsh'));
      if (shouldReplace) await registry.resumeReplacing(suspended, connection, replacement!.id);
      else await registry.resume(suspended, connection);
      suspendedVisible.value = false;
      if (!options.silent)
        feedback.notifySuccess(
          t('sshSuspend.notifications.resumeSuccess', { name: suspended.customName ?? suspended.connectionName }),
        );
      return true;
    } catch (cause) {
      if (!options.silent) feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const resumeMarkedSession = async (workspaceId: string) => {
    const session = registry.sessions.get(workspaceId);
    if (!session?.markedForSuspend.value) return;
    if (session.state.value === 'connected') {
      registry.activate(workspaceId);
      suspendedVisible.value = false;
      return;
    }
    const refreshed = await refreshSuspendedSessionsCatalog();
    if (!refreshed.ok) return;
    const suspended = findSuspendedSessionByOriginalWorkspace(workspaceId);
    if (!suspended) {
      registry.remove(workspaceId, 'Marked suspended session could not be recovered');
      return;
    }
    await resumeSuspended(suspended);
  };

  const recoverMarkedSshSessionsAfterForeground = (): Promise<void> => {
    if (!workspaceActive || !device.isMobile.value) return Promise.resolve();
    if (foregroundRecoveryPromise) return foregroundRecoveryPromise;
    foregroundRecoveryPromise = (async () => {
      const candidates = new Set(
        registry.orderedSessions.value
          .filter(
            (session) =>
              session.markedForSuspend.value &&
              session.state.value !== 'connected' &&
              session.state.value !== 'connecting',
          )
          .map((session) => session.id),
      );
      if (!candidates.size) return;

      for (let attempt = 0; attempt < FOREGROUND_RECOVERY_ATTEMPTS && candidates.size; attempt += 1) {
        if (!workspaceActive || !device.isMobile.value) return;
        for (const workspaceId of [...candidates]) {
          const session = registry.sessions.get(workspaceId);
          if (
            !session?.markedForSuspend.value ||
            session.state.value === 'connected' ||
            session.state.value === 'connecting'
          )
            candidates.delete(workspaceId);
        }
        if (!candidates.size) break;

        const refreshed = await refreshSuspendedSessionsCatalog();
        if (!workspaceActive || !device.isMobile.value) return;
        if (refreshed.ok) {
          for (const workspaceId of [...candidates]) {
            const suspended = findSuspendedSessionByOriginalWorkspace(workspaceId);
            if (!suspended) continue;
            if (await resumeSuspended(suspended, { silent: true })) candidates.delete(workspaceId);
          }
        }
        if (candidates.size) await new Promise((resolve) => window.setTimeout(resolve, FOREGROUND_RECOVERY_DELAY_MS));
      }

      if (!candidates.size) return;
      if (!workspaceActive || !device.isMobile.value) return;
      const finalRefresh = await refreshSuspendedSessionsCatalog();
      if (!workspaceActive || !device.isMobile.value || !finalRefresh.ok) return;
      for (const workspaceId of [...candidates]) {
        const session = registry.sessions.get(workspaceId);
        if (
          !session?.markedForSuspend.value ||
          session.state.value === 'connected' ||
          session.state.value === 'connecting'
        )
          continue;
        const suspended = findSuspendedSessionByOriginalWorkspace(workspaceId);
        if (suspended) {
          await resumeSuspended(suspended, { silent: true });
          continue;
        }
        // A suspend mark is explicit user intent. If takeover never produced a recoverable
        // hanging session, close the stale local tab instead of silently opening a fresh SSH login.
        registry.remove(workspaceId, 'Marked suspended session could not be recovered');
      }
    })().finally(() => {
      foregroundRecoveryPromise = null;
    });
    return foregroundRecoveryPromise;
  };

  const handleDocumentVisibilityChange = () => {
    if (!device.isMobile.value) return;
    if (document.visibilityState === 'hidden') {
      wasDocumentHidden = true;
      return;
    }
    if (!wasDocumentHidden) return;
    wasDocumentHidden = false;
    void recoverMarkedSshSessionsAfterForeground();
  };

  const saveSidebarWidth = (pane: string, width: string) => {
    void preferences
      .update({ sidebarPaneWidths: { ...preferences.values.value.sidebarPaneWidths, [pane]: width } })
      .catch(reportPreferenceSaveError);
  };
  const updateQuickCommandCompactMode = (compact: boolean) => {
    void preferences.update({ quickCommandsCompactMode: compact }).catch(reportPreferenceSaveError);
  };

  const updateLayoutLocked = async (locked: boolean) => {
    try {
      await preferences.update({ layoutLocked: locked });
    } catch {
      feedback.notifyError(t('layoutConfigurator.lockUpdateError'));
    }
  };

  const toggleHeader = async () => {
    await preferences.update({ navBarVisible: !preferences.values.value.navBarVisible });
  };

  const loadQueryActions = async () => {
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
    // Connection success must never perform a later navigation: if the user returns to the
    // dashboard while SSH is still connecting, the background completion should stay there.
    if (router.currentRoute.value.name === 'Workspace') {
      await router.replace({ name: 'Workspace', query: {} });
    }

    for (const id of [...new Set(values)]) await openConnection(await connectionService.get(id));
    if (shouldOpenSuspended) suspendedVisible.value = true;
  };

  const handleGlobalKeydown = (event: KeyboardEvent) => {
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
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activateSession(ids[(index + delta + ids.length) % ids.length]!);
      return;
    }
    const pressed = normalizeShortcut(shortcutFromKeyboardEvent(event));
    if (!pressed) return;
    const target = Object.entries(workspaceFocus.config.value.shortcuts).find(
      ([, config]) => config.shortcut && normalizeShortcut(config.shortcut) === pressed,
    )?.[0];
    if (target) {
      event.preventDefault();
      void focusRegistry.focus(target);
    }
  };
  const handleGlobalKeyup = (event: KeyboardEvent) => {
    if (event.key !== 'Alt') return;
    if (altCycleCandidate) void focusRegistry.focusNext(workspaceFocus.config.value.sequence);
    altCycleCandidate = false;
  };

  onMounted(async () => {
    workspaceActive = true;
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('keyup', handleGlobalKeyup);
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
    stopServerTransferPolling = serverTransfers.startPolling();
    const startup = await Promise.allSettled([
      workspaceLayout.load(),
      workspaceFocus.load(),
      preferences.load(),
      appearance.load(),
      history.load(),
    ]);
    const preferenceLoad = startup[2];
    if (preferenceLoad.status === 'rejected')
      feedback.notifyError(
        preferenceLoad.reason instanceof Error ? preferenceLoad.reason.message : String(preferenceLoad.reason),
      );
    await loadQueryActions();
    if (device.isMobile.value && document.visibilityState === 'visible') void recoverMarkedSshSessionsAfterForeground();
  });
  onBeforeUnmount(() => {
    workspaceActive = false;
    wasDocumentHidden = false;
    window.removeEventListener('keydown', handleGlobalKeydown);
    window.removeEventListener('keyup', handleGlobalKeyup);
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
    data-testid="workspace-root"
    class="flex min-h-0 flex-col overflow-hidden bg-background"
    :class="preferences.values.value.navBarVisible ? 'h-[calc(100dvh-3.5rem)]' : 'h-dvh'"
  >
    <WorkspaceTabBar
      :sessions="registry.orderedSessions.value"
      :active-id="registry.activeId.value"
      :mobile="device.isMobile.value"
      :nav-bar-visible="preferences.values.value.navBarVisible"
      :progress-task-count="progressDisplayTaskCount"
      @activate="activateSession"
      @close="closeSession"
      @close-others="closeOtherSessions"
      @close-right="closeSessionsToRight"
      @close-left="closeSessionsToLeft"
      @toggle-suspend="toggleSuspendMark"
      @reorder="registry.move"
      @new-session="connectionPickerVisible = true"
      @toggle-header="toggleHeader"
      @open-progress="progressDisplayVisible = true"
      @open-layout-configurator="layoutConfiguratorVisible = true"
    />

    <ProgressDisplayModal
      v-if="progressDisplayVisible"
      :visible="true"
      :sources="progressDisplaySources"
      :server-transfers="serverTransfers.items.value"
      :server-transfers-loading="serverTransfers.loading.value"
      :server-transfers-error="serverTransfers.error.value"
      :mobile="device.isMobile.value"
      @close="progressDisplayVisible = false"
      @restore="restoreProgressSource"
      @cancel="cancelProgressTask"
      @cancel-all="cancelProgressSource"
      @remove="removeProgressTask"
    />

    <OverlayPanel
      :visible="connectionPickerVisible"
      :close-on-escape="true"
      panel-class="max-h-[80dvh] max-w-md p-6"
      @close="connectionPickerVisible = false"
    >
      <button
        type="button"
        class="absolute right-2 top-2 p-1 text-text-secondary hover:text-foreground"
        :aria-label="t('common.close')"
        @click="connectionPickerVisible = false"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <h3 class="mb-4 text-center text-lg font-semibold">{{ t('terminalTabBar.selectServerTitle') }}</h3>
      <div class="max-h-[calc(80dvh-7rem)] overflow-y-auto rounded border border-border">
        <WorkspaceConnectionList @open="openConnectionFromPicker" @open-many="openConnectionsFromPicker" />
      </div>
    </OverlayPanel>

    <template v-if="!registry.orderedSessions.value.length">
      <div
        v-if="device.isMobile.value"
        data-testid="mobile-empty-workspace-panels"
        class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(16rem,1fr)_minmax(16rem,1fr)] gap-4 overflow-y-auto p-4"
      >
        <section
          data-testid="mobile-empty-connections-panel"
          class="min-h-0 overflow-hidden rounded-lg border border-border"
        >
          <WorkspaceConnectionList @open="openConnection" @open-many="openConnections" />
        </section>
        <section
          data-testid="mobile-empty-suspended-panel"
          class="min-h-0 overflow-hidden rounded-lg border border-border"
        >
          <SuspendedSessionsPanel
            :can-resume="true"
            :marked-sessions="markedSuspendedSessions"
            @resume="resumeSuspended"
            @resume-marked="resumeMarkedSession"
            @unmark="toggleSuspendMark"
          />
        </section>
      </div>
      <section
        v-else
        data-testid="no-session-placeholder"
        class="mx-2 mb-2 mt-0 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-b-md border border-t-0 border-border bg-header p-4 text-center text-text-secondary"
      >
        <div class="flex flex-col items-center justify-center p-8">
          <i class="fas fa-plug mb-3 text-4xl text-text-secondary" aria-hidden="true"></i>
          <span class="mb-2 text-lg font-medium text-text-secondary">{{ t('layout.noActiveSession.title') }}</span>
          <p class="mt-2 text-xs text-text-secondary">{{ t('layout.noActiveSession.message') }}</p>
        </div>
      </section>
    </template>

    <div
      v-else
      data-testid="workspace-session-region"
      class="relative min-h-0 flex-1"
      :class="
        device.isMobile.value ? '' : 'mx-2 mb-2 mt-0 overflow-hidden rounded-b-md border border-t-0 border-border'
      "
    >
      <WorkspaceSessionSurface
        v-for="session in registry.orderedSessions.value"
        v-show="session.id === registry.activeId.value || session.id === preparingSessionId"
        :key="session.id"
        :ref="(value) => setSurface(session.id, value)"
        class="absolute inset-0"
        :class="
          session.id === preparingSessionId && session.id !== registry.activeId.value
            ? 'invisible pointer-events-none'
            : ''
        "
        :aria-hidden="session.id !== registry.activeId.value"
        :active="session.id === registry.activeId.value"
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
        :status-interval-seconds="preferences.values.value.statusMonitorIntervalSeconds"
        :docker-interval-seconds="preferences.values.value.dockerStatusIntervalSeconds"
        :docker-default-expand="preferences.values.value.dockerDefaultExpand"
        :status-scale="preferences.values.value.statusMonitorScale"
        :status-show-ip="preferences.values.value.showStatusMonitorIpAddress"
        :mobile="device.isMobile.value"
        :clipboard-count="clipboardCount"
        :shared-editor-session="preferences.values.value.shareFileEditorTabs ? registry.sharedEditorSession : undefined"
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
        :quick-command-row-scale="preferences.values.value.quickCommandRowSizeMultiplier"
        :progress-visible="progressVisibility[session.id] !== false"
        :marked-suspended-sessions="markedSuspendedSessions"
        :layout-locked="preferences.values.value.layoutLocked"
        @layout-resize="workspaceLayout.updateNodeSizes"
        @open-connection="openConnection"
        @command="(command, all) => sendCommand(session, command, all)"
        @resume-suspended="resumeSuspended"
        @resume-marked-suspended="resumeMarkedSession"
        @unmark-suspended="toggleSuspendMark"
        @file-clipboard-set="(operation, entries) => setFileClipboard(session, operation, entries)"
        @file-clipboard-paste="(destination) => pasteFileClipboard(session, destination)"
        @server-transfer-started="progressDisplayVisible = true"
        @status-scale="statusScaleSaver.schedule"
        @terminal-font-size="updateTerminalFontSize"
        @editor-font-size="updateEditorFontSize"
        @mobile-editor-font-size="updateMobileEditorFontSize"
        @file-manager-row-scale="updateFileManagerRowScale"
        @file-manager-column-widths="saveFileManagerColumnWidths"
        @quick-command-row-scale="quickCommandRowScaleSaver.schedule"
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
      v-if="suspendedVisible"
      :visible="true"
      :can-resume="true"
      :marked-sessions="markedSuspendedSessions"
      @close="suspendedVisible = false"
      @resume="resumeSuspended"
      @resume-marked="resumeMarkedSession"
      @unmark="toggleSuspendMark"
    />
  </main>
</template>
