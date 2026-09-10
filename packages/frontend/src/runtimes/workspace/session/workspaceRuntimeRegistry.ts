import { computed, nextTick, ref, shallowReactive } from 'vue';
import { logger } from '@/client/logging/logger';
import type { Connection } from '@/features/connections/public';
import {
  applySuspendedAutoTermination,
  refreshSuspendedSessionsAfterHandoff,
  refreshSuspendedSessionsCatalog,
  removeSuspendedSessionFromCatalog,
  type SuspendedAutoTerminationNotice,
  type SuspendedSession,
} from '@/features/ssh-suspend/public';
import type { TerminalViewport } from '@/features/terminal/public';
import { createFileEditorSession } from '@/features/file-editor/public';
import { createFileClipboardController } from '@/features/transfers/public';
import { WorkspaceRuntimeSession } from './workspaceRuntimeSession';

const sessions = shallowReactive(new Map<string, WorkspaceRuntimeSession>());
const activeId = ref<string | null>(null);
const order = ref<string[]>([]);
const fileClipboard = createFileClipboardController();
const sharedEditorSession = createFileEditorSession();
const suspendAutoTerminationNotice = ref<SuspendedAutoTerminationNotice | null>(null);
const resumeInFlight = new Map<string, Promise<WorkspaceRuntimeSession>>();

const handleSuspendedAutoTerminated = (event: { suspendedSessionId: string; reason: string }): void => {
  const notice = applySuspendedAutoTermination(event);
  if (!notice) return;
  logger.warn(
    { suspendedSessionId: event.suspendedSessionId, reason: event.reason },
    'Suspended Workspace auto-terminated',
  );
  suspendAutoTerminationNotice.value = notice;
  void refreshSuspendedSessionsCatalog();
};

const orderedSessions = computed(() =>
  order.value.map((id) => sessions.get(id)).filter((session): session is WorkspaceRuntimeSession => Boolean(session)),
);
const activeSession = computed(() => (activeId.value ? (sessions.get(activeId.value) ?? null) : null));

const add = (session: WorkspaceRuntimeSession, index = order.value.length): WorkspaceRuntimeSession => {
  sessions.set(session.id, session);
  const next = [...order.value];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, session.id);
  order.value = next;
  activeId.value = session.id;
  logger.debug(
    { workspaceId: session.id, connectionId: session.connection.id, sessionCount: sessions.size },
    'Workspace runtime registered',
  );
  return session;
};

const removeRuntime = (id: string, reason: string): void => {
  const session = sessions.get(id);
  if (!session) return;
  const ids = [...order.value];
  const index = ids.indexOf(id);
  const shouldRefreshSuspendHandoff = session.markedForSuspend.value && session.state.value === 'connected';
  session.dispose(reason);
  if (shouldRefreshSuspendHandoff) refreshSuspendedSessionsAfterHandoff(session.id);
  if (fileClipboard.value.value?.sourceScopeId === id) fileClipboard.clear();
  sharedEditorSession.closeScope(id);
  sessions.delete(id);
  order.value = order.value.filter((sessionId) => sessionId !== id);
  logger.debug({ workspaceId: id, reason, sessionCount: sessions.size }, 'Workspace runtime removed');
  if (activeId.value === id) {
    const next = ids[index + 1] ?? ids[index - 1] ?? null;
    activeId.value = next && sessions.has(next) ? next : null;
  }
};

const restoreActive = (preferredId: string | null, fallbackId: string | null): void => {
  if (preferredId && sessions.has(preferredId)) activeId.value = preferredId;
  else if (fallbackId && sessions.has(fallbackId)) activeId.value = fallbackId;
};

const runResume = (
  suspended: SuspendedSession,
  connection: Connection,
  replaceWorkspaceId?: string,
): Promise<WorkspaceRuntimeSession> => {
  const existing = resumeInFlight.get(suspended.id);
  if (existing) {
    logger.trace({ suspendedSessionId: suspended.id }, 'Reusing in-flight Workspace resume');
    return existing;
  }
  logger.debug({ suspendedSessionId: suspended.id, replaceWorkspaceId }, 'Workspace resume queued');
  const task = (async () => {
    const previousActiveId = activeId.value;
    const replaceIndex = replaceWorkspaceId ? order.value.indexOf(replaceWorkspaceId) : -1;
    const oldSession = replaceWorkspaceId ? sessions.get(replaceWorkspaceId) : undefined;
    const shouldRestorePrevious = Boolean(previousActiveId && oldSession && previousActiveId !== oldSession.id);
    const session = new WorkspaceRuntimeSession(connection, {
      onSuspendedAutoTerminated: handleSuspendedAutoTerminated,
    });
    const replacingVisibleSlot = Boolean(oldSession && replaceIndex >= 0);

    if (replacingVisibleSlot) {
      // Mobile foreground recovery needs the replacement Terminal mounted while suspend.resume
      // restores the tail/history. Swap the visible tab slot atomically instead of appending a
      // temporary second tab and removing the stale disconnected tab only after resume completes.
      sessions.set(session.id, session);
      order.value = order.value.map((id) => (id === oldSession!.id ? session.id : id));
      activeId.value = session.id;
    } else {
      add(session, replaceIndex >= 0 ? replaceIndex : order.value.length);
    }

    try {
      await nextTick();
      await session.resume(suspended.id, suspended.suspendedAt);
      removeSuspendedSessionFromCatalog(suspended.id);
      if (oldSession && sessions.get(oldSession.id) === oldSession) {
        removeRuntime(oldSession.id, 'Replaced by resumed suspended session');
      }
      if (shouldRestorePrevious) restoreActive(previousActiveId, session.id);
      else activeId.value = session.id;
      return session;
    } catch (error) {
      removeRuntime(session.id, 'Suspended session resume failed');
      if (replacingVisibleSlot && oldSession && sessions.get(oldSession.id) === oldSession) {
        const next = [...order.value];
        const insertIndex = Math.max(0, Math.min(replaceIndex, next.length));
        if (!next.includes(oldSession.id)) next.splice(insertIndex, 0, oldSession.id);
        order.value = next;
      }
      restoreActive(previousActiveId, oldSession?.id ?? null);
      throw error;
    }
  })().finally(() => {
    if (resumeInFlight.get(suspended.id) === task) resumeInFlight.delete(suspended.id);
  });
  resumeInFlight.set(suspended.id, task);
  return task;
};

export const workspaceRuntimeRegistry = {
  sessions,
  activeId,
  order,
  orderedSessions,
  activeSession,
  fileClipboard,
  sharedEditorSession,
  suspendAutoTerminationNotice,

  async open(connection: Connection, viewport?: TerminalViewport): Promise<WorkspaceRuntimeSession> {
    if (connection.type !== 'SSH') throw new Error('Only SSH connections can open a Workspace session.');
    const session = add(
      new WorkspaceRuntimeSession(connection, { onSuspendedAutoTerminated: handleSuspendedAutoTerminated }),
    );
    try {
      await session.connect(viewport);
      return session;
    } catch (error) {
      // Keep ordinary failed tabs visible so the user can inspect the error or retry explicitly.
      throw error;
    }
  },

  resume(suspended: SuspendedSession, connection: Connection): Promise<WorkspaceRuntimeSession> {
    return runResume(suspended, connection);
  },

  resumeReplacing(
    suspended: SuspendedSession,
    connection: Connection,
    replaceWorkspaceId: string,
  ): Promise<WorkspaceRuntimeSession> {
    return runResume(suspended, connection, replaceWorkspaceId);
  },

  activate(id: string): void {
    if (sessions.has(id)) activeId.value = id;
  },

  move(id: string, targetId: string, placement: 'before' | 'after' = 'before'): void {
    if (id === targetId || !sessions.has(id) || !sessions.has(targetId)) return;
    const next = order.value.filter((sessionId) => sessionId !== id);
    const targetIndex = next.indexOf(targetId);
    if (targetIndex < 0) return;
    next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, id);
    order.value = next;
  },

  remove(id: string, reason = 'Workspace tab closed'): void {
    removeRuntime(id, reason);
  },

  closeOthers(id: string): void {
    for (const sessionId of [...order.value])
      if (sessionId !== id) removeRuntime(sessionId, 'Other Workspace tab closed');
    this.activate(id);
  },

  closeToRight(id: string): void {
    const ids = [...order.value];
    const index = ids.indexOf(id);
    if (index < 0) return;
    for (const sessionId of ids.slice(index + 1)) removeRuntime(sessionId, 'Workspace tab closed');
  },

  closeToLeft(id: string): void {
    const ids = [...order.value];
    const index = ids.indexOf(id);
    if (index < 0) return;
    for (const sessionId of ids.slice(0, index)) removeRuntime(sessionId, 'Workspace tab closed');
  },

  disposeAll(): void {
    for (const id of [...order.value]) removeRuntime(id, 'Workspace runtime disposed');
  },
};

const handlePageHide = (event: PageTransitionEvent): void => {
  if (event.persisted) return;
  workspaceRuntimeRegistry.disposeAll();
};

if (typeof window !== 'undefined') window.addEventListener('pagehide', handlePageHide);

export type WorkspaceRuntimeRegistry = typeof workspaceRuntimeRegistry;
