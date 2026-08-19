import { computed, reactive } from 'vue';
import { defineStore } from 'pinia';

export type ProgressTaskKind =
  | 'upload'
  | 'download'
  | 'copy'
  | 'move'
  | 'compress'
  | 'decompress'
  | 'transfer'
  | 'other';

export interface ProgressTaskRegistration {
  id: string;
  kind: ProgressTaskKind;
  title: string;
  detail?: string;
  progress?: number | null;
  status?: string;
  cancellable?: boolean;
  cancel?: () => void | Promise<void>;
}

export interface ProgressSourceRegistration {
  id: string;
  sessionId?: string;
  label?: string;
  cancelAll?: () => void | Promise<void>;
}

export interface RegisteredProgressTask extends ProgressTaskRegistration {
  key: string;
  sourceId: string;
  sessionId?: string;
  sourceLabel?: string;
}

export interface RegisteredProgressSource extends ProgressSourceRegistration {
  tasks: RegisteredProgressTask[];
}

interface ProgressSourceState extends ProgressSourceRegistration {
  hidden: boolean;
  hiddenExplicitly: boolean;
  tasks: Record<string, ProgressTaskRegistration>;
}

/**
 * Shared registry for long-running UI progress.
 *
 * Feature modules own their work and only publish task state here. The registry never
 * imports SFTP/upload/archive implementations; cancellation is delegated to the callback
 * supplied by the registering module. This keeps the global progress UI independent of
 * the transport or operation that produced a task.
 */
export const useProgressCenterStore = defineStore('progressCenter', () => {
  const sources = reactive<Record<string, ProgressSourceState>>({});

  const ensureSource = (registration: ProgressSourceRegistration): ProgressSourceState => {
    const existing = sources[registration.id];
    if (existing) {
      existing.sessionId = registration.sessionId;
      existing.label = registration.label;
      existing.cancelAll = registration.cancelAll;
      return existing;
    }

    const created: ProgressSourceState = {
      ...registration,
      hidden: false,
      hiddenExplicitly: false,
      tasks: {},
    };
    sources[registration.id] = created;
    return created;
  };

  const registerSource = (registration: ProgressSourceRegistration) => {
    ensureSource(registration);
  };

  const syncSourceTasks = (
    registration: ProgressSourceRegistration,
    tasks: ProgressTaskRegistration[],
  ) => {
    const source = ensureSource(registration);
    const previousIds = new Set(Object.keys(source.tasks));
    const nextIds = new Set(tasks.map(task => task.id));
    const hasNewTask = tasks.some(task => !previousIds.has(task.id));

    for (const id of previousIds) {
      if (!nextIds.has(id)) delete source.tasks[id];
    }
    for (const task of tasks) source.tasks[task.id] = task;

    const hadTasks = previousIds.size > 0;
    if (tasks.length === 0) {
      // Only clear an explicit hide after a real registered task has finished. When the
      // provider UI races ahead of its first registry sync, preserve the user's Hide click.
      if (hadTasks) {
        source.hidden = false;
        source.hiddenExplicitly = false;
      }
    } else if (hasNewTask && hadTasks) {
      // A genuinely new task arriving beside an older hidden task should surface the
      // provider again, so new work is never silently hidden by an old preference.
      source.hidden = false;
      source.hiddenExplicitly = false;
    } else if (hasNewTask && !source.hiddenExplicitly) {
      source.hidden = false;
    }
  };

  const startTask = (
    registration: ProgressSourceRegistration,
    task: ProgressTaskRegistration,
  ) => {
    const source = ensureSource(registration);
    source.tasks[task.id] = task;
    source.hidden = false;
    source.hiddenExplicitly = false;
  };

  const updateTask = (
    sourceId: string,
    taskId: string,
    patch: Partial<Omit<ProgressTaskRegistration, 'id'>>,
  ) => {
    const task = sources[sourceId]?.tasks[taskId];
    if (!task) return;
    Object.assign(task, patch);
  };

  const finishTask = (sourceId: string, taskId: string) => {
    const source = sources[sourceId];
    if (!source) return;
    delete source.tasks[taskId];
    if (Object.keys(source.tasks).length === 0) {
      source.hidden = false;
      source.hiddenExplicitly = false;
    }
  };

  const unregisterSource = (sourceId: string) => {
    delete sources[sourceId];
  };

  const hideSource = (sourceId: string) => {
    const source = sources[sourceId];
    if (!source) return;
    source.hidden = true;
    source.hiddenExplicitly = true;
  };

  const restoreSource = (sourceId: string) => {
    const source = sources[sourceId];
    if (!source) return;
    source.hidden = false;
    source.hiddenExplicitly = false;
  };

  const setSourceProviderAttached = (sourceId: string, attached: boolean) => {
    const source = sources[sourceId];
    if (!source) return;
    if (!attached) {
      // A provider pane can disappear while its session-owned task keeps running. Surface
      // that task in the global Progress Display without pretending the user hid it.
      source.hidden = true;
      return;
    }
    // Reattaching a provider restores only automatic hiding. Respect an explicit Hide.
    if (!source.hiddenExplicitly) source.hidden = false;
  };

  const isSourceHidden = (sourceId: string) => Boolean(sources[sourceId]?.hidden);

  const toRegisteredTask = (source: ProgressSourceState, task: ProgressTaskRegistration): RegisteredProgressTask => ({
    ...task,
    key: `${source.id}:${task.id}`,
    sourceId: source.id,
    sessionId: source.sessionId,
    sourceLabel: source.label,
  });

  const hiddenSources = computed<RegisteredProgressSource[]>(() => {
    const result: RegisteredProgressSource[] = [];
    for (const source of Object.values(sources)) {
      if (!source.hidden) continue;
      const tasks = Object.values(source.tasks).map(task => toRegisteredTask(source, task));
      if (tasks.length === 0) continue;
      result.push({
        id: source.id,
        sessionId: source.sessionId,
        label: source.label,
        tasks,
      });
    }
    return result;
  });

  const hiddenTasks = computed<RegisteredProgressTask[]>(() =>
    hiddenSources.value.flatMap(source => source.tasks),
  );

  const cancelTask = async (sourceId: string, taskId: string) => {
    const task = sources[sourceId]?.tasks[taskId];
    if (!task?.cancel || task.cancellable === false) return;
    task.status = 'cancelling';
    await task.cancel();
  };

  const cancelSource = async (sourceId: string) => {
    const source = sources[sourceId];
    if (!source) return;
    const cancellableTasks = Object.values(source.tasks)
      .filter(task => task.cancel && task.cancellable !== false && task.status !== 'cancelling');
    if (cancellableTasks.length === 0) return;

    if (source.cancelAll) {
      for (const task of cancellableTasks) task.status = 'cancelling';
      await source.cancelAll();
      return;
    }
    await Promise.all(cancellableTasks.map(task => cancelTask(sourceId, task.id)));
  };

  return {
    sources,
    hiddenSources,
    hiddenTasks,
    registerSource,
    startTask,
    updateTask,
    finishTask,
    syncSourceTasks,
    unregisterSource,
    hideSource,
    restoreSource,
    setSourceProviderAttached,
    isSourceHidden,
    cancelTask,
    cancelSource,
  };
});
