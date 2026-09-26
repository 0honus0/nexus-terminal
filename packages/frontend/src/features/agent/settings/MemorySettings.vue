<script setup lang="ts">
  import { UiButton, UiEmptyState, UiInfoHint, UiSelect } from '@/foundation/ui';
  import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import { agentHostEvents } from '../events/agent-host-events';
  import { NONE_OPTION, pickOption } from '../common/pick-option';
  import {
    agentApi,
    formatAgentApiError,
    toAgentApiError,
    type AgentAppSummaryDto,
    type AgentMemoryImportConfirmationDto,
    type AgentMemoryStatusDto,
    type AgentMemoryViewDto,
  } from '../api/agent-api';
  import { formatAgentDateTime } from '../locale-format';

  const props = defineProps<{ apps: AgentAppSummaryDto[]; busy: boolean }>();
  const { t, locale } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.memory');

  const selectedAppId = ref('');
  const status = ref<AgentMemoryStatusDto | 'all'>('all');
  const memories = shallowRef<AgentMemoryViewDto[]>([]);
  const drafts = ref<Record<string, string>>({});
  const memoryBaselines = ref<Record<string, string>>({});
  const draftConflicts = ref<Record<string, boolean>>({});
  const loading = ref(false);
  const localBusy = ref(false);

  const sourceAppId = ref('');
  const sourceMemories = shallowRef<AgentMemoryViewDto[]>([]);
  const sourceMemoryId = ref('');
  const importPreview = shallowRef<AgentMemoryImportConfirmationDto | null>(null);
  const importLoading = ref(false);
  let memoriesGeneration = 0;
  let draftsAppId = '';
  let sourceMemoriesGeneration = 0;

  const disabled = computed(() => props.busy || localBusy.value);
  const selectedApp = computed(() => props.apps.find((app) => app.id === selectedAppId.value) ?? null);
  const sourceApps = computed(() => props.apps.filter((app) => app.id !== selectedAppId.value));

  const appOptions = computed(() =>
    props.apps.map((app) => ({ value: app.id, label: `${app.displayName} · ${app.id}` })),
  );
  const statusOptions = computed(() => [
    { value: 'all', label: t('agent.settings.memory.statusAll') },
    { value: 'candidate', label: t('agent.settings.memory.statusCandidate') },
    { value: 'published', label: t('agent.settings.memory.statusPublished') },
    { value: 'revoked', label: t('agent.settings.memory.statusRevoked') },
  ]);
  const sourceAppOptions = computed(() => [
    { value: NONE_OPTION, label: t('agent.settings.memory.selectSourceApp') },
    ...sourceApps.value.map((app) => ({ value: app.id, label: `${app.displayName} · ${app.id}` })),
  ]);
  const sourceMemoryOptions = computed(() => [
    { value: NONE_OPTION, label: t('agent.settings.memory.selectSourceMemory') },
    ...sourceMemories.value.map((memory) => ({ value: memory.id, label: memory.content.slice(0, 80) })),
  ]);

  const setStatus = (value: unknown): void => {
    const next = pickOption(value, ['all', 'candidate', 'published', 'revoked'] as const);
    if (next) status.value = next;
  };
  const setSourceAppId = (value: unknown): void => {
    if (value === NONE_OPTION) sourceAppId.value = '';
    else if (typeof value === 'string') sourceAppId.value = value;
  };
  const setSourceMemoryId = (value: unknown): void => {
    importPreview.value = null;
    if (value === NONE_OPTION) sourceMemoryId.value = '';
    else if (typeof value === 'string') sourceMemoryId.value = value;
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.settings.memory.requestFailed'), t);
  const formatTime = (value: number | null): string =>
    value === null ? t('agent.settings.memory.never') : formatAgentDateTime(locale.value, new Date(value * 1000));
  const confidence = (value: number): string => `${Math.round(value * 100)}%`;
  const appName = (appId: string): string => props.apps.find((app) => app.id === appId)?.displayName ?? appId;

  const draftDirty = (memoryId: string): boolean =>
    drafts.value[memoryId] !== undefined && drafts.value[memoryId] !== memoryBaselines.value[memoryId];
  const draftConflict = (memoryId: string): boolean => Boolean(draftConflicts.value[memoryId] && draftDirty(memoryId));
  const useLatestDraft = (memory: AgentMemoryViewDto): void => {
    drafts.value = { ...drafts.value, [memory.id]: memoryBaselines.value[memory.id] ?? memory.content };
    draftConflicts.value = { ...draftConflicts.value, [memory.id]: false };
  };

  const provenanceProjection = (memory: AgentMemoryViewDto): string[] => {
    const projection: string[] = [];
    if (memory.proposedByRuntimeId) projection.push(`runtime · ${memory.proposedByRuntimeId.slice(0, 32)}`);
    if (!isRecord(memory.sourceRefs)) return projection.slice(0, 4);
    for (const key of ['kind', 'runId', 'artifactId', 'sourceAppId', 'sourceMemoryId', 'sourceVersion']) {
      const value = memory.sourceRefs[key];
      if (typeof value === 'string' && value) projection.push(`${key} · ${value.slice(0, 80)}`);
      else if (typeof value === 'number' && Number.isFinite(value)) projection.push(`${key} · ${value}`);
      if (projection.length >= 4) break;
    }
    return projection;
  };

  const previewSnapshot = computed(() => {
    const snapshot = importPreview.value?.snapshot;
    if (!isRecord(snapshot)) return null;
    return {
      content: typeof snapshot.content === 'string' ? snapshot.content : '',
      confidence: typeof snapshot.confidence === 'number' ? snapshot.confidence : null,
      expiresAt: Number.isSafeInteger(snapshot.expiresAt) ? Number(snapshot.expiresAt) : null,
    };
  });

  const loadMemories = async (): Promise<void> => {
    const generation = ++memoriesGeneration;
    const appId = selectedAppId.value;
    const requestedStatus = status.value;
    if (!appId) {
      memories.value = [];
      drafts.value = {};
      memoryBaselines.value = {};
      draftConflicts.value = {};
      draftsAppId = '';
      loading.value = false;
      return;
    }
    if (draftsAppId !== appId) {
      drafts.value = {};
      memoryBaselines.value = {};
      draftConflicts.value = {};
      draftsAppId = appId;
    }
    loading.value = true;
    try {
      const next = await agentApi.memories(appId, requestedStatus, 100);
      if (generation !== memoriesGeneration || selectedAppId.value !== appId || status.value !== requestedStatus)
        return;
      const nextDrafts = { ...drafts.value };
      const nextBaselines = { ...memoryBaselines.value };
      const nextConflicts = { ...draftConflicts.value };
      for (const memory of next) {
        const previousBaseline = memoryBaselines.value[memory.id];
        const previousDraft = drafts.value[memory.id];
        const wasDirty =
          previousBaseline !== undefined && previousDraft !== undefined && previousDraft !== previousBaseline;
        const serverChanged = previousBaseline !== undefined && previousBaseline !== memory.content;
        nextBaselines[memory.id] = memory.content;
        if (!wasDirty) {
          nextDrafts[memory.id] = memory.content;
          nextConflicts[memory.id] = false;
        } else if (serverChanged) {
          nextConflicts[memory.id] = true;
        }
      }
      memories.value = next;
      drafts.value = nextDrafts;
      memoryBaselines.value = nextBaselines;
      draftConflicts.value = nextConflicts;
    } catch (cause) {
      if (generation !== memoriesGeneration || selectedAppId.value !== appId || status.value !== requestedStatus)
        return;
      operationFeedback.notifyError({ operation: 'load-memories', message: explain(cause), cause });
    } finally {
      if (generation === memoriesGeneration && selectedAppId.value === appId && status.value === requestedStatus) {
        loading.value = false;
      }
    }
  };

  const loadSourceMemories = async (): Promise<void> => {
    const generation = ++sourceMemoriesGeneration;
    const appId = sourceAppId.value;
    if (!appId) {
      sourceMemories.value = [];
      importLoading.value = false;
      return;
    }
    importLoading.value = true;
    try {
      const next = await agentApi.memories(appId, 'published', 100);
      if (generation !== sourceMemoriesGeneration || sourceAppId.value !== appId) return;
      const now = Math.floor(Date.now() / 1000);
      const filtered = next.filter(
        (memory) => memory.status === 'published' && (memory.expiresAt === null || memory.expiresAt > now),
      );
      sourceMemories.value = filtered;
      if (sourceMemoryId.value) {
        const selectedSource = filtered.find((memory) => memory.id === sourceMemoryId.value) ?? null;
        if (!selectedSource) {
          sourceMemoryId.value = '';
          importPreview.value = null;
        } else if (
          importPreview.value &&
          (importPreview.value.sourceAppId !== appId ||
            importPreview.value.sourceMemoryId !== selectedSource.id ||
            importPreview.value.sourceVersion !== selectedSource.version ||
            importPreview.value.expiresAt <= now)
        ) {
          importPreview.value = null;
        }
      }
    } catch (cause) {
      if (generation !== sourceMemoriesGeneration || sourceAppId.value !== appId) return;
      operationFeedback.notifyError({ operation: 'load-source-memories', message: explain(cause), cause });
    } finally {
      if (generation === sourceMemoriesGeneration && sourceAppId.value === appId) importLoading.value = false;
    }
  };

  const reconcileSelection = (): void => {
    if (!props.apps.length) {
      selectedAppId.value = '';
      sourceAppId.value = '';
      return;
    }
    if (!props.apps.some((app) => app.id === selectedAppId.value)) {
      selectedAppId.value = props.apps.find((app) => app.id === 'nexus.agent')?.id ?? props.apps[0]!.id;
    }
    if (!sourceApps.value.some((app) => app.id === sourceAppId.value)) {
      sourceAppId.value = sourceApps.value[0]?.id ?? '';
    }
  };

  const mutate = async (operation: string, action: () => Promise<void>, success: string): Promise<void> => {
    if (disabled.value) return;
    localBusy.value = true;
    try {
      await action();
      operationFeedback.notifySuccess(success);
    } catch (cause) {
      const apiError = toAgentApiError(cause);
      if (['MEMORY_VERSION_CONFLICT', 'MEMORY_REVIEW_STATE_INVALID', 'NOT_FOUND'].includes(apiError.code)) {
        await loadMemories();
      }
      const message =
        apiError.code === 'MEMORY_VERSION_CONFLICT' ? t('agent.settings.memory.conflict') : explain(cause);
      operationFeedback.notifyError({ operation, message, cause });
    } finally {
      localBusy.value = false;
    }
  };

  const publish = (memory: AgentMemoryViewDto): void => {
    const content = (drafts.value[memory.id] ?? memory.content).trim();
    if (!content) return;
    void mutate(
      'publish-memory',
      async () => {
        await agentApi.reviewMemory(selectedAppId.value, memory, 'publish', content);
        await loadMemories();
        await loadSourceMemories();
      },
      t('agent.settings.memory.published'),
    );
  };

  const reject = (memory: AgentMemoryViewDto): void => {
    void mutate(
      'reject-memory',
      async () => {
        await agentApi.reviewMemory(selectedAppId.value, memory, 'reject');
        await loadMemories();
      },
      t('agent.settings.memory.rejected'),
    );
  };

  const revoke = (memory: AgentMemoryViewDto): void => {
    void mutate(
      'revoke-memory',
      async () => {
        await agentApi.reviewMemory(selectedAppId.value, memory, 'revoke');
        await loadMemories();
        await loadSourceMemories();
      },
      t('agent.settings.memory.revoked'),
    );
  };

  const previewImport = (): void => {
    if (!selectedAppId.value || !sourceAppId.value || !sourceMemoryId.value || disabled.value) return;
    void mutate(
      'preview-import',
      async () => {
        importPreview.value = await agentApi.previewMemoryImport(
          selectedAppId.value,
          sourceAppId.value,
          sourceMemoryId.value,
        );
      },
      t('agent.settings.memory.importPreviewReady'),
    );
  };

  const confirmImport = (): void => {
    const confirmation = importPreview.value;
    if (!confirmation || disabled.value) return;
    void mutate(
      'confirm-import',
      async () => {
        await agentApi.confirmMemoryImport(selectedAppId.value, confirmation.id);
        importPreview.value = null;
        sourceMemoryId.value = '';
        await loadMemories();
      },
      t('agent.settings.memory.imported'),
    );
  };

  watch(
    () => props.apps.map((app) => `${app.id}@${app.version}#${app.stateVersion}`).join('|'),
    () => {
      reconcileSelection();
      void loadMemories();
      void loadSourceMemories();
    },
    { immediate: true },
  );
  watch(selectedAppId, () => {
    importPreview.value = null;
    reconcileSelection();
    void loadMemories();
  });
  watch(status, () => void loadMemories());
  watch(sourceAppId, (nextAppId, previousAppId) => {
    if (nextAppId !== previousAppId) {
      sourceMemoryId.value = '';
      importPreview.value = null;
    }
    void loadSourceMemories();
  });

  const onMemoryChanged = (payload: Record<string, unknown>): void => {
    if (typeof payload.appId !== 'string') return;
    if (payload.appId === selectedAppId.value) void loadMemories();
    if (payload.appId === sourceAppId.value) void loadSourceMemories();
  };
  const stopMemoryChanged = agentHostEvents.on('memory-changed', onMemoryChanged);
  onBeforeUnmount(stopMemoryChanged);
</script>

<template>
  <section
    class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
    data-testid="agent-memory-settings"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 agent-settings-head"
    >
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <i class="fa-solid fa-brain text-sm" aria-hidden="true"></i>
        </div>
        <div class="flex items-center gap-1.5">
          <h3 class="text-sm font-bold text-foreground">{{ $t('agent.settings.memory.title') }}</h3>
          <UiInfoHint :text="$t('agent.settings.memory.description')" />
        </div>
      </div>
      <UiButton appearance="soft" tone="neutral" type="button" :disabled="disabled || loading" @click="loadMemories">
        <i class="fa-solid fa-rotate mr-1" aria-hidden="true"></i>
        {{ $t('agent.settings.memory.reload') }}
      </UiButton>
    </div>

    <div class="space-y-5 p-4 sm:p-5">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-text-secondary">
          {{ $t('agent.settings.memory.app') }}
          <UiSelect
            v-model="selectedAppId"
            class="mt-1 w-full"
            :disabled="disabled || apps.length === 0"
            :options="appOptions"
            :aria-label="$t('agent.settings.memory.app')"
          />
        </label>
        <label class="text-xs text-text-secondary">
          {{ $t('agent.settings.memory.status') }}
          <UiSelect
            class="mt-1 w-full"
            :disabled="disabled"
            :model-value="status"
            :options="statusOptions"
            :aria-label="$t('agent.settings.memory.status')"
            @update:model-value="(value: unknown) => setStatus(value)"
          />
        </label>
      </div>

      <p v-if="loading" class="py-4 text-center text-xs text-text-secondary">
        <i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-primary"></i>{{ $t('agent.settings.memory.loading') }}
      </p>
      <UiEmptyState
        v-else-if="memories.length === 0"
        dense
        icon="fa-solid fa-brain"
        :title="$t('agent.settings.memory.empty')"
      />

      <div v-else class="space-y-3">
        <article v-for="memory in memories" :key="memory.id" class="rounded-lg bg-header/25 p-3.5">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                :class="
                  memory.status === 'candidate'
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : memory.status === 'published'
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-border bg-header text-text-secondary'
                "
              >
                {{ $t(`agent.settings.memory.status${memory.status[0]!.toUpperCase()}${memory.status.slice(1)}`) }}
              </span>
              <span class="text-[11px] text-text-secondary">
                {{ $t('agent.settings.memory.confidence', { value: confidence(memory.confidence) }) }}
              </span>
            </div>
            <span class="font-mono text-[11px] text-text-secondary">v{{ memory.version }}</span>
          </div>

          <textarea
            v-if="memory.status === 'candidate'"
            v-model="drafts[memory.id]"
            rows="4"
            maxlength="16384"
            class="mt-3 w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground"
            :disabled="disabled"
          ></textarea>
          <div
            v-if="memory.status === 'candidate' && draftConflict(memory.id)"
            class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning"
          >
            <span>{{ $t('agent.settings.memory.draftConflict') }}</span>
            <UiButton
              appearance="soft"
              tone="neutral"
              density="compact"
              type="button"
              :disabled="disabled"
              @click="useLatestDraft(memory)"
            >
              {{ $t('agent.settings.memory.useLatest') }}
            </UiButton>
          </div>
          <p v-else class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
            {{ memory.content }}
          </p>

          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
            <span>{{ $t('agent.settings.memory.updated') }}: {{ formatTime(memory.updatedAt) }}</span>
            <span>{{ $t('agent.settings.memory.expires') }}: {{ formatTime(memory.expiresAt) }}</span>
          </div>
          <div v-if="provenanceProjection(memory).length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="item in provenanceProjection(memory)"
              :key="item"
              class="max-w-full truncate rounded-md bg-header px-2 py-1 font-mono text-[11px] text-text-secondary"
              :title="item"
            >
              {{ item }}
            </span>
          </div>

          <div v-if="memory.status === 'candidate'" class="mt-3 flex flex-wrap gap-2">
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="disabled || !(drafts[memory.id] ?? '').trim()"
              @click="publish(memory)"
            >
              {{ $t('agent.settings.memory.publish') }}
            </UiButton>
            <UiButton appearance="soft" tone="danger" type="button" :disabled="disabled" @click="reject(memory)">
              {{ $t('agent.settings.memory.reject') }}
            </UiButton>
          </div>
          <div v-else-if="memory.status === 'published'" class="mt-3">
            <UiButton appearance="soft" tone="danger" type="button" :disabled="disabled" @click="revoke(memory)">
              {{ $t('agent.settings.memory.revoke') }}
            </UiButton>
          </div>
        </article>
      </div>

      <div class="border-t border-border/60 pt-5">
        <div class="flex items-center gap-1.5">
          <h4 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.memory.importTitle') }}</h4>
          <UiInfoHint :text="$t('agent.settings.memory.importDescription')" />
        </div>

        <div class="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <label class="text-xs text-text-secondary">
            {{ $t('agent.settings.memory.sourceApp') }}
            <UiSelect
              class="mt-1 w-full"
              :disabled="disabled || sourceApps.length === 0"
              :model-value="sourceAppId || NONE_OPTION"
              :options="sourceAppOptions"
              :aria-label="$t('agent.settings.memory.sourceApp')"
              @update:model-value="(value: unknown) => setSourceAppId(value)"
            />
          </label>
          <label class="text-xs text-text-secondary">
            {{ $t('agent.settings.memory.sourceMemory') }}
            <UiSelect
              class="mt-1 w-full"
              :disabled="disabled || importLoading || !sourceAppId"
              :model-value="sourceMemoryId || NONE_OPTION"
              :options="sourceMemoryOptions"
              :aria-label="$t('agent.settings.memory.sourceMemory')"
              @update:model-value="(value: unknown) => setSourceMemoryId(value)"
            />
          </label>
          <div class="flex items-end gap-2">
            <UiInfoHint
              v-if="!selectedAppId || !sourceAppId || !sourceMemoryId"
              :text="$t('agent.settings.disabledReason.selectionRequired')"
              class="mb-1"
            />
            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="disabled || !selectedAppId || !sourceAppId || !sourceMemoryId"
              @click="previewImport"
              class="min-w-0 flex-1"
            >
              {{ $t('agent.settings.memory.previewImport') }}
            </UiButton>
          </div>
        </div>

        <p v-if="sourceAppId && !importLoading && sourceMemories.length === 0" class="mt-2 text-xs text-text-secondary">
          {{ $t('agent.settings.memory.noPublishedSource') }}
        </p>

        <div v-if="importPreview" class="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="text-xs font-semibold text-foreground">{{ $t('agent.settings.memory.previewTitle') }}</div>
              <div class="mt-0.5 text-[11px] text-text-secondary">
                {{ appName(importPreview.sourceAppId) }} → {{ selectedApp?.displayName ?? selectedAppId }}
              </div>
            </div>
            <span class="text-[11px] text-text-secondary">
              {{ $t('agent.settings.memory.confirmationExpires') }}: {{ formatTime(importPreview.expiresAt) }}
            </span>
          </div>
          <p class="mt-3 whitespace-pre-wrap break-words text-xs text-foreground">{{ previewSnapshot?.content }}</p>
          <div class="mt-2 flex flex-wrap gap-3 text-[11px] text-text-secondary">
            <span v-if="previewSnapshot?.confidence !== null">
              {{ $t('agent.settings.memory.confidence', { value: confidence(previewSnapshot?.confidence ?? 0) }) }}
            </span>
            <span>{{ $t('agent.settings.memory.expires') }}: {{ formatTime(previewSnapshot?.expiresAt ?? null) }}</span>
          </div>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="disabled"
            @click="confirmImport"
            class="mt-3"
          >
            {{ $t('agent.settings.memory.confirmImport') }}
          </UiButton>
        </div>
      </div>
    </div>
  </section>
</template>
