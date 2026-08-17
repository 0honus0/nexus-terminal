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
}

export interface RegisteredProgressTask extends ProgressTaskRegistration {
  key: string;
  sourceId: string;
  sessionId?: string;
  sourceLabel?: string;
}

interface ProgressSourceState extends ProgressSourceRegistration {
  hidden: boolean;
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
      return existing;
    }

    const created: ProgressSourceState = {
      ...registration,
      hidden: false,
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

    // A freshly-started task must be visible by default even when an earlier task from
    // the same provider had been hidden. Empty providers also reset their UI state.
    if (hasNewTask || tasks.length === 0) source.hidden = false;
  };

  const startTask = (
    registration: ProgressSourceRegistration,
    task: ProgressTaskRegistration,
  ) => {
    const source = ensureSource(registration);
    source.tasks[task.id] = task;
    source.hidden = false;
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
    if (Object.keys(source.tasks).length === 0) source.hidden = false;
  };

  const unregisterSource = (sourceId: string) => {
    delete sources[sourceId];
  };

  const hideSource = (sourceId: string) => {
    const source = sources[sourceId];
    if (source && Object.keys(source.tasks).length > 0) source.hidden = true;
  };

  const restoreSource = (sourceId: string) => {
    const source = sources[sourceId];
    if (source) source.hidden = false;
  };

  const isSourceHidden = (sourceId: string) => Boolean(sources[sourceId]?.hidden);

  const hiddenTasks = computed<RegisteredProgressTask[]>(() => {
    const result: RegisteredProgressTask[] = [];
    for (const source of Object.values(sources)) {
      if (!source.hidden) continue;
      for (const task of Object.values(source.tasks)) {
        result.push({
          ...task,
          key: `${source.id}:${task.id}`,
          sourceId: source.id,
          sessionId: source.sessionId,
          sourceLabel: source.label,
        });
      }
    }
    return result;
  });

  const cancelTask = async (sourceId: string, taskId: string) => {
    const task = sources[sourceId]?.tasks[taskId];
    if (!task?.cancel || task.cancellable === false) return;
    task.status = 'cancelling';
    await task.cancel();
  };

  return {
    sources,
    hiddenTasks,
    registerSource,
    startTask,
    updateTask,
    finishTask,
    syncSourceTasks,
    unregisterSource,
    hideSource,
    restoreSource,
    isSourceHidden,
    cancelTask,
  };
});
