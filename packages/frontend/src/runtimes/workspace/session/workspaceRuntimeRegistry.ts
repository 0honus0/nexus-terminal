import { computed, nextTick, ref, shallowReactive } from 'vue';
import type { Connection } from '@/features/connections/public';
import {
  applySuspendedAutoTermination,
  refreshSuspendedSessionsCatalog,
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
  return session;
};

const removeRuntime = (id: string, reason: string): void => {
  const session = sessions.get(id);
  if (!session) return;
  const ids = [...order.value];
  const index = ids.indexOf(id);
  session.dispose(reason);
  if (fileClipboard.value.value?.sourceScopeId === id) fileClipboard.clear();
  sharedEditorSession.closeScope(id);
  sessions.delete(id);
  order.value = order.value.filter((sessionId) => sessionId !== id);
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
  if (existing) return existing;
  const task = (async () => {
    const previousActiveId = activeId.value;
    const replaceIndex = replaceWorkspaceId ? order.value.indexOf(replaceWorkspaceId) : -1;
    const oldSession = replaceWorkspaceId ? sessions.get(replaceWorkspaceId) : undefined;
    const shouldRestorePrevious = Boolean(previousActiveId && oldSession && previousActiveId !== oldSession.id);
    const session = add(
      new WorkspaceRuntimeSession(connection, { onSuspendedAutoTerminated: handleSuspendedAutoTerminated }),
      replaceIndex >= 0 ? replaceIndex : order.value.length,
    );
    try {
      await nextTick();
      await session.resume(suspended.id);
      if (oldSession && sessions.get(oldSession.id) === oldSession) {
        removeRuntime(oldSession.id, 'Replaced by resumed suspended session');
      }
      if (shouldRestorePrevious) restoreActive(previousActiveId, session.id);
      else activeId.value = session.id;
      return session;
    } catch (error) {
      removeRuntime(session.id, 'Suspended session resume failed');
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
