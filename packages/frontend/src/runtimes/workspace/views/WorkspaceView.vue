<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseSpinner } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser';
  import { createLatestValueSaver } from '@/foundation/async';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry, normalizeShortcut, shortcutFromKeyboardEvent } from '@/shared/focus/public';
  import { connectionService, type Connection } from '@/features/connections/public';
  import { terminalScrollbackForRuntime, usePreferences } from '@/features/preferences/public';
  import { useAppearanceStore } from '@/features/appearance/public';
  import { useCommandHistoryStore } from '@/features/command-history/public';
  import { RemoteDesktopModal, type RemoteDesktopConnection } from '@/features/remote-desktop/public';
  import {
    ProgressDisplayModal,
    useServerTransfersStore,
    type FileClipboardOperation,
    type ProgressSource,
  } from '@/features/transfers/public';
  import type { RemoteFileEntry } from '@/features/filesystem/public';
  import {
    SuspendedSessionsModal,
    SuspendedSessionsPanel,
    findSuspendedSessionByOriginalWorkspace,
    refreshSuspendedSessionsCatalog,
    type SuspendedSession,
  } from '@/features/ssh-suspend/public';
  import WorkspaceConnectionList from '../components/WorkspaceConnectionList.vue';
  import WorkspaceLayoutConfigurator from '../components/WorkspaceLayoutConfigurator.vue';
  import WorkspaceFocusConfigurator from '../components/WorkspaceFocusConfigurator.vue';
  import WorkspaceSessionSurface from '../components/WorkspaceSessionSurface.vue';
  import WorkspaceTabBar from '../components/WorkspaceTabBar.vue';
  import { workspaceLayout } from '../layout/workspaceLayout';
  import { workspaceFocus } from '../focus/workspaceFocus';
  import { workspaceRuntimeRegistry, type WorkspaceRuntimeSession } from '../session';

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
  const appearance = useAppearanceStore();
  const history = useCommandHistoryStore();
  const serverTransfers = useServerTransfersStore();
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
  const remoteVisible = ref(false);
  const remoteConnection = ref<RemoteDesktopConnection | null>(null);
  const layoutConfiguratorVisible = ref(false);
  const progressDisplayVisible = ref(false);
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
  });
  const fileManagerRowScaleSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (scale) => preferences.update({ fileManagerRowSizeMultiplier: scale }),
  });
  const quickCommandRowScaleSaver = createLatestValueSaver<number>({
    delayMs: 240,
    save: (scale) => preferences.update({ quickCommandRowSizeMultiplier: scale }),
  });
  const remoteDesktopSizeSaver = createLatestValueSaver<{ type: 'RDP' | 'VNC'; width: number; height: number }>({
    delayMs: 240,
    save: ({ type, width, height }) =>
      preferences.update(
        type === 'RDP'
          ? { rdpModalWidth: width, rdpModalHeight: height }
          : { vncModalWidth: width, vncModalHeight: height },
      ),
  });
  const terminalFontSaver = createLatestValueSaver<{ mobile: boolean; size: number }>({
    delayMs: 240,
    save: ({ mobile, size }) =>
      appearance.update(mobile ? { terminalFontSizeMobile: size } : { terminalFontSize: size }),
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
  const saveFileManagerColumnWidths = (widths: Record<string, number>) =>
    preferences.update({ fileManagerColWidths: widths });
  const updateTerminalFontSize = (size: number) => {
    if (device.isMobile.value) appearance.settings.terminalFontSizeMobile = size;
    else appearance.settings.terminalFontSize = size;
    terminalFontSaver.schedule({ mobile: device.isMobile.value, size });
  };
  const updateEditorFontSize = (size: number) => {
    appearance.settings.editorFontSize = size;
    editorFontSaver.schedule(size);
  };
  const updateMobileEditorFontSize = (size: number) => {
    appearance.settings.mobileEditorFontSize = size;
    mobileEditorFontSaver.schedule(size);
  };
  const focusConfiguratorVisible = ref(false);
  let altCycleCandidate = false;
  let stopServerTransferPolling: (() => void) | undefined;

  const remoteDesktopWidth = computed(() =>
    remoteConnection.value?.type === 'VNC'
      ? preferences.values.value.vncModalWidth
      : preferences.values.value.rdpModalWidth,
  );
  const remoteDesktopHeight = computed(() =>
    remoteConnection.value?.type === 'VNC'
      ? preferences.values.value.vncModalHeight
      : preferences.values.value.rdpModalHeight,
  );
  const saveRemoteDesktopSize = (size: { width: number; height: number }) => {
    if (!remoteConnection.value) return;
    remoteDesktopSizeSaver.schedule({ type: remoteConnection.value.type, ...size });
  };

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
  const progressDisplaySources = computed<ProgressSource[]>(() => {
    const sources = [...hiddenProgressSources.value];
    if (serverTransfers.progressTasks.length) {
      sources.push({
        id: 'server-transfers',
        label: t('progressCenter.serverTransfers'),
        tasks: serverTransfers.progressTasks,
        restorable: false,
      });
    }
    return sources;
  });
  const progressDisplayTaskCount = computed(() =>
    progressDisplaySources.value.reduce((count, source) => count + source.tasks.length, 0),
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
    const index = controller.tasks.value.findIndex((task) => task.id === taskId);
    if (index >= 0) controller.tasks.value.splice(index, 1);
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
    const id = appearance.settings.activeTerminalThemeId;
    return appearance.themes.find((theme) => theme.id === id)?.themeData;
  });

  const terminalVisual = computed(() => ({
    backgroundEnabled: appearance.settings.terminalBackgroundEnabled,
    backgroundImageUrl: appearance.settings.terminalBackgroundImage,
    backgroundOverlayOpacity: appearance.settings.terminalBackgroundOverlayOpacity,
    customHtml: appearance.settings.terminalCustomHtml,
    textStroke: {
      enabled: Boolean(appearance.settings.terminalTextStrokeEnabled),
      width: appearance.settings.terminalTextStrokeWidth ?? 0,
      color: appearance.settings.terminalTextStrokeColor ?? '#000000',
    },
    textShadow: {
      enabled: Boolean(appearance.settings.terminalTextShadowEnabled),
      offsetX: appearance.settings.terminalTextShadowOffsetX ?? 0,
      offsetY: appearance.settings.terminalTextShadowOffsetY ?? 0,
      blur: appearance.settings.terminalTextShadowBlur ?? 0,
      color: appearance.settings.terminalTextShadowColor ?? '#000000',
    },
  }));
  const terminalScrollback = computed(() =>
    terminalScrollbackForRuntime(preferences.values.value.terminalScrollbackLimit),
  );
  const terminalFontSize = computed(() =>
    device.isMobile.value
      ? (appearance.settings.terminalFontSizeMobile ?? appearance.settings.terminalFontSize)
      : appearance.settings.terminalFontSize,
  );

  const setSurface = (id: string, value: unknown) => {
    if (value) surfaces.set(id, value as SurfaceApi);
    else surfaces.delete(id);
  };

  const openConnection = async (connection: Connection): Promise<void> => {
    if (connection.type === 'RDP' || connection.type === 'VNC') {
      remoteConnection.value = { id: connection.id, name: connection.name || connection.host, type: connection.type };
      remoteVisible.value = true;
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

  const activateSession = (id: string) => {
    registry.activate(id);
    void nextTick(() => {
      surfaces.get(id)?.fitTerminal?.();
      surfaces.get(id)?.focusTerminal?.();
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
    const suspended = refreshed.ok ? findSuspendedSessionByOriginalWorkspace(workspaceId) : undefined;
    if (!suspended) return;
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
        session.fallbackSuspendToReconnect();
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
    void preferences.update({ sidebarPaneWidths: { ...preferences.values.value.sidebarPaneWidths, [pane]: width } });
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

  const loadQueryConnection = async () => {
    const raw = route.query.connectionId;
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((value) => Number(value))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!values.length) return;
    try {
      for (const id of [...new Set(values)]) await openConnection(await connectionService.get(id));
    } finally {
      await router.replace({ name: 'Workspace', query: {} });
    }
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
    await Promise.allSettled([
      workspaceLayout.load(),
      workspaceFocus.load(),
      preferences.load(),
      appearance.load(),
      history.load(),
    ]);
    await loadQueryConnection();
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
    void remoteDesktopSizeSaver.dispose({ flush: true });
    void editorFontSaver.dispose({ flush: true });
    void mobileEditorFontSaver.dispose({ flush: true });
  });
</script>

<template>
  <main
    class="flex min-h-0 flex-col overflow-hidden bg-background"
    :class="preferences.values.value.navBarVisible ? 'h-[calc(100dvh-3.5rem)]' : 'h-dvh'"
  >
    <div class="flex items-center justify-between gap-2 border-b border-border bg-header/30 px-2 py-1">
      <div class="flex items-center gap-2 text-sm text-text-secondary">
        <strong class="text-foreground">{{ t('workspace.title') }}</strong>
        <span>{{ t('workspace.sessions', { count: registry.orderedSessions.value.length }) }}</span>
        <BaseSpinner v-if="opening || workspaceLayout.loading.value" class="h-4 w-4" />
      </div>
      <div class="flex gap-2">
        <BaseButton size="sm" variant="ghost" @click="toggleHeader">{{
          t(preferences.values.value.navBarVisible ? 'header.hide' : 'header.show')
        }}</BaseButton>
        <BaseButton
          v-if="progressDisplayTaskCount"
          data-testid="transfer-progress-toggle"
          size="sm"
          variant="ghost"
          @click="progressDisplayVisible = true"
          >{{ t('progressCenter.title') }} ({{ progressDisplayTaskCount }})</BaseButton
        >
        <BaseButton size="sm" @click="suspendedVisible = true">{{ t('suspendedSshSessions.modalTitle') }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="focusConfiguratorVisible = true">{{
          t('commandInputBar.configureFocusSwitch')
        }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="layoutConfiguratorVisible = true">{{
          t('layout.configure')
        }}</BaseButton>
      </div>
    </div>

    <WorkspaceTabBar
      :sessions="registry.orderedSessions.value"
      :active-id="registry.activeId.value"
      :mobile="device.isMobile.value"
      @activate="activateSession"
      @close="closeSession"
      @close-others="closeOtherSessions"
      @close-right="closeSessionsToRight"
      @close-left="closeSessionsToLeft"
      @toggle-suspend="toggleSuspendMark"
      @reorder="registry.move"
    />

    <div v-if="!registry.orderedSessions.value.length" class="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
      <section class="min-h-0 overflow-hidden rounded-lg border border-border">
        <WorkspaceConnectionList @open="openConnection" @open-many="openConnections" />
      </section>
      <section class="min-h-0 overflow-hidden rounded-lg border border-border">
        <SuspendedSessionsPanel
          :can-resume="true"
          :marked-sessions="markedSuspendedSessions"
          @resume="resumeSuspended"
          @resume-marked="resumeMarkedSession"
          @unmark="toggleSuspendMark"
        />
      </section>
    </div>

    <div v-else class="relative min-h-0 flex-1">
      <WorkspaceSessionSurface
        v-for="session in registry.orderedSessions.value"
        v-show="session.id === registry.activeId.value"
        :key="session.id"
        :ref="(value) => setSurface(session.id, value)"
        class="absolute inset-0"
        :session="session"
        :layout="workspaceLayout.tree.value"
        :sidebars="workspaceLayout.sidebars.value"
        :terminal-font-family="appearance.settings.terminalFontFamily"
        :terminal-font-size="terminalFontSize"
        :terminal-theme="terminalTheme"
        :terminal-visual="terminalVisual"
        :terminal-scrollback="terminalScrollback"
        :right-click-copy-paste="preferences.values.value.terminalRightClickCopyPaste"
        :editor-font-family="appearance.settings.editorFontFamily ?? undefined"
        :editor-font-size="appearance.settings.editorFontSize"
        :mobile-editor-font-size="appearance.settings.mobileEditorFontSize"
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
        :file-manager-row-scale="preferences.values.value.fileManagerRowSizeMultiplier"
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
        @file-manager-row-scale="fileManagerRowScaleSaver.schedule"
        @file-manager-column-widths="saveFileManagerColumnWidths"
        @quick-command-row-scale="quickCommandRowScaleSaver.schedule"
        @quick-command-compact-mode="preferences.update({ quickCommandsCompactMode: $event })"
        @progress-visible="setProgressVisible(session.id, $event)"
        @interaction="session.reconnectNow()"
        @sidebar-width="saveSidebarWidth"
      />
    </div>

    <ProgressDisplayModal
      :visible="progressDisplayVisible"
      :sources="progressDisplaySources"
      @close="progressDisplayVisible = false"
      @restore="restoreProgressSource"
      @cancel="cancelProgressTask"
      @cancel-all="cancelProgressSource"
      @remove="removeProgressTask"
    />
    <WorkspaceLayoutConfigurator
      :visible="layoutConfiguratorVisible"
      :layout-locked="preferences.values.value.layoutLocked"
      @layout-locked="updateLayoutLocked"
      @close="layoutConfiguratorVisible = false"
    />
    <WorkspaceFocusConfigurator :visible="focusConfiguratorVisible" @close="focusConfiguratorVisible = false" />
    <SuspendedSessionsModal
      :visible="suspendedVisible"
      :can-resume="true"
      :marked-sessions="markedSuspendedSessions"
      @close="suspendedVisible = false"
      @resume="resumeSuspended"
      @resume-marked="resumeMarkedSession"
      @unmark="toggleSuspendMark"
    />
    <RemoteDesktopModal
      :visible="remoteVisible"
      :connection="remoteConnection"
      :width="remoteDesktopWidth"
      :height="remoteDesktopHeight"
      @size-change="saveRemoteDesktopSize"
      @close="remoteVisible = false"
    />
  </main>
</template>
