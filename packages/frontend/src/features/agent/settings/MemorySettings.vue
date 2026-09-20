<script setup lang="ts">
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    formatAgentApiError,
    toAgentApiError,
    type AgentAppSummary,
    type AgentMemoryImportConfirmation,
    type AgentMemoryStatus,
    type AgentMemoryView,
  } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; busy: boolean }>();
  const { t } = useI18n();

  const selectedAppId = ref('');
  const status = ref<AgentMemoryStatus | 'all'>('all');
  const memories = ref<AgentMemoryView[]>([]);
  const drafts = ref<Record<string, string>>({});
  const loading = ref(false);
  const localBusy = ref(false);
  const error = ref('');
  const notice = ref('');

  const sourceAppId = ref('');
  const sourceMemories = ref<AgentMemoryView[]>([]);
  const sourceMemoryId = ref('');
  const importPreview = ref<AgentMemoryImportConfirmation | null>(null);
  const importLoading = ref(false);
  let memoriesGeneration = 0;
  let sourceMemoriesGeneration = 0;

  const disabled = computed(() => props.busy || localBusy.value);
  const selectedApp = computed(() => props.apps.find((app) => app.id === selectedAppId.value) ?? null);
  const sourceApps = computed(() => props.apps.filter((app) => app.id !== selectedAppId.value));

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.settings.memory.requestFailed'));
  const formatTime = (value: number | null): string =>
    value === null ? t('agent.settings.memory.never') : new Date(value * 1000).toLocaleString();
  const confidence = (value: number): string => `${Math.round(value * 100)}%`;
  const appName = (appId: string): string => props.apps.find((app) => app.id === appId)?.displayName ?? appId;

  const provenanceProjection = (memory: AgentMemoryView): string[] => {
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
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = '';
    try {
      const next = await agentApi.memories(appId, requestedStatus, 100);
      if (generation !== memoriesGeneration || selectedAppId.value !== appId || status.value !== requestedStatus)
        return;
      memories.value = next;
      drafts.value = Object.fromEntries(next.map((memory) => [memory.id, memory.content]));
    } catch (cause) {
      if (generation !== memoriesGeneration || selectedAppId.value !== appId || status.value !== requestedStatus)
        return;
      error.value = explain(cause);
    } finally {
      if (generation === memoriesGeneration && selectedAppId.value === appId && status.value === requestedStatus) {
        loading.value = false;
      }
    }
  };

  const loadSourceMemories = async (): Promise<void> => {
    const generation = ++sourceMemoriesGeneration;
    const appId = sourceAppId.value;
    sourceMemoryId.value = '';
    importPreview.value = null;
    if (!appId) {
      sourceMemories.value = [];
      importLoading.value = false;
      return;
    }
    importLoading.value = true;
    error.value = '';
    try {
      const next = await agentApi.memories(appId, 'published', 100);
      if (generation !== sourceMemoriesGeneration || sourceAppId.value !== appId) return;
      const now = Math.floor(Date.now() / 1000);
      sourceMemories.value = next.filter(
        (memory) => memory.status === 'published' && (memory.expiresAt === null || memory.expiresAt > now),
      );
    } catch (cause) {
      if (generation !== sourceMemoriesGeneration || sourceAppId.value !== appId) return;
      sourceMemories.value = [];
      error.value = explain(cause);
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

  const mutate = async (action: () => Promise<void>, success: string): Promise<void> => {
    if (disabled.value) return;
    localBusy.value = true;
    error.value = '';
    notice.value = '';
    try {
      await action();
      notice.value = success;
    } catch (cause) {
      const apiError = toAgentApiError(cause);
      if (['MEMORY_VERSION_CONFLICT', 'MEMORY_REVIEW_STATE_INVALID', 'NOT_FOUND'].includes(apiError.code)) {
        await loadMemories();
      }
      error.value = apiError.code === 'MEMORY_VERSION_CONFLICT' ? t('agent.settings.memory.conflict') : explain(cause);
    } finally {
      localBusy.value = false;
    }
  };

  const publish = (memory: AgentMemoryView): void => {
    const content = (drafts.value[memory.id] ?? memory.content).trim();
    if (!content) return;
    void mutate(async () => {
      await agentApi.reviewMemory(selectedAppId.value, memory, 'publish', content);
      await loadMemories();
      await loadSourceMemories();
    }, t('agent.settings.memory.published'));
  };

  const reject = (memory: AgentMemoryView): void => {
    void mutate(async () => {
      await agentApi.reviewMemory(selectedAppId.value, memory, 'reject');
      await loadMemories();
    }, t('agent.settings.memory.rejected'));
  };

  const revoke = (memory: AgentMemoryView): void => {
    void mutate(async () => {
      await agentApi.reviewMemory(selectedAppId.value, memory, 'revoke');
      await loadMemories();
      await loadSourceMemories();
    }, t('agent.settings.memory.revoked'));
  };

  const previewImport = (): void => {
    if (!selectedAppId.value || !sourceAppId.value || !sourceMemoryId.value || disabled.value) return;
    void mutate(async () => {
      importPreview.value = await agentApi.previewMemoryImport(
        selectedAppId.value,
        sourceAppId.value,
        sourceMemoryId.value,
      );
    }, t('agent.settings.memory.importPreviewReady'));
  };

  const confirmImport = (): void => {
    const confirmation = importPreview.value;
    if (!confirmation || disabled.value) return;
    void mutate(async () => {
      await agentApi.confirmMemoryImport(selectedAppId.value, confirmation.id);
      importPreview.value = null;
      sourceMemoryId.value = '';
      await loadMemories();
    }, t('agent.settings.memory.imported'));
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
    notice.value = '';
    importPreview.value = null;
    reconcileSelection();
    void loadMemories();
  });
  watch(status, () => void loadMemories());
  watch(sourceAppId, () => void loadSourceMemories());

  const onMemoryChanged = (event: Event): void => {
    if (!(event instanceof CustomEvent) || !isRecord(event.detail) || typeof event.detail.appId !== 'string') return;
    if (event.detail.appId === selectedAppId.value) void loadMemories();
    if (event.detail.appId === sourceAppId.value) void loadSourceMemories();
  };
  window.addEventListener('nexus:agent:memory-changed', onMemoryChanged);
  onBeforeUnmount(() => window.removeEventListener('nexus:agent:memory-changed', onMemoryChanged));
</script>

<template>
  <section
    class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
    data-testid="agent-memory-settings"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5"
    >
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <i class="fa-solid fa-brain text-sm" aria-hidden="true"></i>
        </div>
        <div>
          <h3 class="text-sm font-bold text-foreground">{{ $t('agent.settings.memory.title') }}</h3>
          <p class="text-xs text-text-secondary">{{ $t('agent.settings.memory.description') }}</p>
        </div>
      </div>
      <button
        type="button"
        class="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-text-secondary hover:text-foreground disabled:opacity-50"
        :disabled="disabled || loading"
        @click="loadMemories"
      >
        <i class="fa-solid fa-rotate mr-1" aria-hidden="true"></i>
        {{ $t('agent.settings.memory.reload') }}
      </button>
    </div>

    <div class="space-y-5 p-4 sm:p-5">
      <div v-if="error" class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
        {{ error }}
      </div>
      <div v-if="notice" class="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
        {{ notice }}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-text-secondary">
          {{ $t('agent.settings.memory.app') }}
          <select
            v-model="selectedAppId"
            class="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground"
            :disabled="disabled || apps.length === 0"
          >
            <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.displayName }} · {{ app.id }}</option>
          </select>
        </label>
        <label class="text-xs text-text-secondary">
          {{ $t('agent.settings.memory.status') }}
          <select
            v-model="status"
            class="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground"
            :disabled="disabled"
          >
            <option value="all">{{ $t('agent.settings.memory.statusAll') }}</option>
            <option value="candidate">{{ $t('agent.settings.memory.statusCandidate') }}</option>
            <option value="published">{{ $t('agent.settings.memory.statusPublished') }}</option>
            <option value="revoked">{{ $t('agent.settings.memory.statusRevoked') }}</option>
          </select>
        </label>
      </div>

      <p v-if="loading" class="py-4 text-center text-xs text-text-secondary">
        <i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-primary"></i>{{ $t('agent.settings.memory.loading') }}
      </p>
      <div
        v-else-if="memories.length === 0"
        class="rounded-xl border border-dashed border-border/70 bg-header/20 px-4 py-6 text-center text-xs text-text-secondary"
      >
        {{ $t('agent.settings.memory.empty') }}
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="memory in memories"
          :key="memory.id"
          class="rounded-xl border border-border/70 bg-background p-3.5"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
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
              <span class="text-[10px] text-text-secondary">
                {{ $t('agent.settings.memory.confidence', { value: confidence(memory.confidence) }) }}
              </span>
            </div>
            <span class="font-mono text-[10px] text-text-secondary">v{{ memory.version }}</span>
          </div>

          <textarea
            v-if="memory.status === 'candidate'"
            v-model="drafts[memory.id]"
            rows="4"
            maxlength="16384"
            class="mt-3 w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground"
            :disabled="disabled"
          ></textarea>
          <p v-else class="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
            {{ memory.content }}
          </p>

          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-secondary">
            <span>{{ $t('agent.settings.memory.updated') }}: {{ formatTime(memory.updatedAt) }}</span>
            <span>{{ $t('agent.settings.memory.expires') }}: {{ formatTime(memory.expiresAt) }}</span>
          </div>
          <div v-if="provenanceProjection(memory).length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="item in provenanceProjection(memory)"
              :key="item"
              class="max-w-full truncate rounded-md bg-header px-2 py-1 font-mono text-[9px] text-text-secondary"
              :title="item"
            >
              {{ item }}
            </span>
          </div>

          <div v-if="memory.status === 'candidate'" class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              :disabled="disabled || !(drafts[memory.id] ?? '').trim()"
              @click="publish(memory)"
            >
              {{ $t('agent.settings.memory.publish') }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-error/30 px-3 py-1.5 text-xs text-error disabled:opacity-50"
              :disabled="disabled"
              @click="reject(memory)"
            >
              {{ $t('agent.settings.memory.reject') }}
            </button>
          </div>
          <div v-else-if="memory.status === 'published'" class="mt-3">
            <button
              type="button"
              class="rounded-lg border border-error/30 px-3 py-1.5 text-xs text-error disabled:opacity-50"
              :disabled="disabled"
              @click="revoke(memory)"
            >
              {{ $t('agent.settings.memory.revoke') }}
            </button>
          </div>
        </article>
      </div>

      <div class="border-t border-border/60 pt-5">
        <div>
          <h4 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.memory.importTitle') }}</h4>
          <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.memory.importDescription') }}</p>
        </div>

        <div class="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <label class="text-xs text-text-secondary">
            {{ $t('agent.settings.memory.sourceApp') }}
            <select
              v-model="sourceAppId"
              class="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground"
              :disabled="disabled || sourceApps.length === 0"
            >
              <option value="">{{ $t('agent.settings.memory.selectSourceApp') }}</option>
              <option v-for="app in sourceApps" :key="app.id" :value="app.id">
                {{ app.displayName }} · {{ app.id }}
              </option>
            </select>
          </label>
          <label class="text-xs text-text-secondary">
            {{ $t('agent.settings.memory.sourceMemory') }}
            <select
              v-model="sourceMemoryId"
              class="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground"
              :disabled="disabled || importLoading || !sourceAppId"
              @change="importPreview = null"
            >
              <option value="">{{ $t('agent.settings.memory.selectSourceMemory') }}</option>
              <option v-for="memory in sourceMemories" :key="memory.id" :value="memory.id">
                {{ memory.content.slice(0, 80) }}
              </option>
            </select>
          </label>
          <div class="flex items-end">
            <button
              type="button"
              class="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground disabled:opacity-50"
              :disabled="disabled || !selectedAppId || !sourceAppId || !sourceMemoryId"
              @click="previewImport"
            >
              {{ $t('agent.settings.memory.previewImport') }}
            </button>
          </div>
        </div>

        <p v-if="sourceAppId && !importLoading && sourceMemories.length === 0" class="mt-2 text-xs text-text-secondary">
          {{ $t('agent.settings.memory.noPublishedSource') }}
        </p>

        <div v-if="importPreview" class="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="text-xs font-semibold text-foreground">{{ $t('agent.settings.memory.previewTitle') }}</div>
              <div class="mt-0.5 text-[10px] text-text-secondary">
                {{ appName(importPreview.sourceAppId) }} → {{ selectedApp?.displayName ?? selectedAppId }}
              </div>
            </div>
            <span class="text-[10px] text-text-secondary">
              {{ $t('agent.settings.memory.confirmationExpires') }}: {{ formatTime(importPreview.expiresAt) }}
            </span>
          </div>
          <p class="mt-3 whitespace-pre-wrap break-words text-xs text-foreground">{{ previewSnapshot?.content }}</p>
          <div class="mt-2 flex flex-wrap gap-3 text-[10px] text-text-secondary">
            <span v-if="previewSnapshot?.confidence !== null">
              {{ $t('agent.settings.memory.confidence', { value: confidence(previewSnapshot?.confidence ?? 0) }) }}
            </span>
            <span>{{ $t('agent.settings.memory.expires') }}: {{ formatTime(previewSnapshot?.expiresAt ?? null) }}</span>
          </div>
          <button
            type="button"
            class="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            :disabled="disabled"
            @click="confirmImport"
          >
            {{ $t('agent.settings.memory.confirmImport') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
