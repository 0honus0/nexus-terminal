<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { RecycleScroller } from 'vue-virtual-scroller';
  import { BaseListboxSelect, type BaseListboxOption } from '@/foundation/ui';
  import type {
    AgentAppSummary,
    AgentArtifactRef,
    ArtifactCleanupPreview,
    ArtifactStorageSummary,
  } from '../api/agent-api';
  import { agentApi, formatAgentApiError } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[] }>();
  const { t } = useI18n();

  const appOptions = computed<BaseListboxOption[]>(() => [
    { value: '', label: t('agent.files.allApps') },
    ...props.apps.map((app) => ({ value: app.id, label: app.displayName })),
  ]);

  const retentionOptions = computed<BaseListboxOption[]>(() => [
    { value: 'all', label: t('agent.files.allRetention') },
    { value: 'retained', label: t('agent.files.retained') },
    { value: 'unretained', label: t('agent.files.unretained') },
  ]);

  const items = ref<AgentArtifactRef[]>([]);
  const nextCursor = ref<string | null>(null);
  const storage = ref<ArtifactStorageSummary | null>(null);
  const cleanupPreview = ref<ArtifactCleanupPreview | null>(null);
  const query = ref('');
  const appId = ref('');
  const retained = ref<'all' | 'retained' | 'unretained'>('all');
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');

  const bytes = (value: number): string => {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  };

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'AGENT_REQUEST_FAILED');

  const filters = () => ({
    ...(query.value.trim() ? { q: query.value.trim() } : {}),
    ...(appId.value ? { appId: appId.value } : {}),
    ...(retained.value === 'all' ? {} : { retained: retained.value === 'retained' }),
  });

  const load = async (): Promise<void> => {
    busy.value = true;
    error.value = '';
    try {
      const [page, nextStorage] = await Promise.all([agentApi.files(filters()), agentApi.storage()]);
      items.value = page.items;
      nextCursor.value = page.nextCursor;
      storage.value = nextStorage;
      cleanupPreview.value = null;
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!nextCursor.value || busy.value) return;
    busy.value = true;
    try {
      const page = await agentApi.files({ ...filters(), before: nextCursor.value });
      const known = new Set(items.value.map((item) => item.id));
      items.value.push(...page.items.filter((item) => !known.has(item.id)));
      nextCursor.value = page.nextCursor;
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const toggleRetain = async (artifact: AgentArtifactRef): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const updated = await agentApi.retainArtifact(artifact, !artifact.retained);
      items.value = items.value.map((item) => (item.id === updated.id ? updated : item));
      storage.value = await agentApi.storage();
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const previewCleanup = async (): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
      cleanupPreview.value = await agentApi.previewArtifactCleanup();
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const confirmCleanup = async (): Promise<void> => {
    const preview = cleanupPreview.value;
    if (!preview || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const result = await agentApi.confirmArtifactCleanup(preview.confirmationId);
      notice.value = `${result.deletedCount}`;
      cleanupPreview.value = null;
      await load();
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const downloadUrl = (artifact: AgentArtifactRef): string =>
    `/api/v1/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}/content`;

  onMounted(load);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background">
    <header class="shrink-0 border-b border-border/70 bg-card/60 px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-[11px] text-primary">
              <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
            </div>
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.hub.files') }}</h2>
              <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.files.libraryHint') }}</p>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="notice" class="rounded-lg bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">
            {{ $t('agent.files.cleanupDone', { count: notice }) }}
          </span>

          <button
            v-if="!cleanupPreview"
            type="button"
            class="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] font-medium text-text-secondary hover:bg-header hover:text-foreground transition-colors"
            :disabled="busy"
            @click="previewCleanup"
          >
            <i class="fa-solid fa-broom text-[9px]" aria-hidden="true"></i>
            {{ $t('agent.files.cleanup') }}
          </button>

          <!-- 就地直接出现在右侧的确认操作条 -->
          <div
            v-else
            class="flex items-center gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-1 text-[11px] shadow-xs transition-all"
          >
            <i class="fa-solid fa-triangle-exclamation text-warning text-[10px]" aria-hidden="true"></i>
            <span class="text-foreground text-[10px] font-medium">
              {{
                $t('agent.files.cleanupPreview', {
                  count: cleanupPreview.selectedCount,
                  bytes: bytes(cleanupPreview.selectedBytes),
                  protected: cleanupPreview.protectedCount,
                })
              }}
            </span>
            <div class="flex items-center gap-1.5 border-l border-warning/30 pl-2">
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-[10px] text-text-secondary hover:bg-header hover:text-foreground transition-colors"
                @click="cleanupPreview = null"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-lg bg-error px-2.5 py-1 text-[10px] font-semibold text-white shadow-2xs hover:bg-error/90 disabled:opacity-50 transition-colors"
                :disabled="busy"
                @click="confirmCleanup"
              >
                {{ $t('agent.files.cleanupConfirm') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="storage" class="mt-3 grid grid-cols-3 gap-2">
        <div class="rounded-xl border border-border/70 bg-background px-3 py-2">
          <div class="text-[8px] font-medium uppercase tracking-wide text-text-secondary">
            {{ $t('agent.files.used') }}
          </div>
          <div class="mt-1 text-xs font-semibold">{{ bytes(storage.totalBytes) }}</div>
        </div>
        <div class="rounded-xl border border-border/70 bg-background px-3 py-2">
          <div class="text-[8px] font-medium uppercase tracking-wide text-text-secondary">
            {{ $t('agent.files.protected') }}
          </div>
          <div class="mt-1 text-xs font-semibold">{{ bytes(storage.protectedBytes) }}</div>
        </div>
        <div class="rounded-xl border border-border/70 bg-background px-3 py-2">
          <div class="text-[8px] font-medium uppercase tracking-wide text-text-secondary">
            {{ $t('agent.files.reclaimable') }}
          </div>
          <div class="mt-1 text-xs font-semibold">{{ bytes(storage.reclaimableBytes) }}</div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="relative min-w-52 flex-1">
          <i
            class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
            aria-hidden="true"
          ></i>
          <input
            v-model="query"
            type="search"
            data-no-highlight
            class="h-8 w-full rounded-xl border border-border/80 bg-input/70 py-1 pl-8 pr-3 text-xs outline-none transition-colors hover:border-border focus:border-foreground/35 focus:ring-0 focus:shadow-none"
            :placeholder="$t('agent.files.search')"
            @keydown.enter="load"
          />
        </div>
        <div class="w-36 shrink-0">
          <BaseListboxSelect
            v-model="appId"
            :options="appOptions"
            size="sm"
            :highlight="false"
            @update:model-value="load"
          />
        </div>
        <div class="w-36 shrink-0">
          <BaseListboxSelect
            v-model="retained"
            :options="retentionOptions"
            size="sm"
            :highlight="false"
            @update:model-value="load"
          />
        </div>
        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-header px-3.5 text-xs font-medium text-foreground hover:bg-border/60 hover:text-foreground active:scale-98 transition-all disabled:opacity-50"
          :disabled="busy"
          @click="load"
        >
          <i class="fa-solid fa-magnifying-glass text-[10px] text-text-secondary" aria-hidden="true"></i>
          <span>{{ $t('agent.files.searchAction') }}</span>
        </button>
      </div>

      <p v-if="error" class="mt-2 rounded-lg bg-error/10 px-3 py-2 text-[10px] text-error">{{ error }}</p>
    </header>

    <div
      v-if="items.length === 0 && !busy"
      class="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center"
    >
      <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-header text-text-secondary">
        <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
      </div>
      <p class="mt-3 text-[10px] text-text-secondary">{{ $t('agent.files.empty') }}</p>
    </div>

    <RecycleScroller
      v-else
      class="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      :items="items"
      :item-size="76"
      key-field="id"
    >
      <template #default="{ item }">
        <article
          class="my-1 flex h-[68px] items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3 transition-colors hover:bg-card"
        >
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-header text-text-secondary">
            <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[11px] font-semibold">{{ item.originalName }}</div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 text-[8px] text-text-secondary">
              <span class="rounded bg-header px-1.5 py-0.5">{{ item.appId }}</span>
              <span>{{ bytes(item.sizeBytes) }}</span
              ><span>{{ item.mediaType }}</span
              ><span>{{ item.status }}</span>
            </div>
          </div>
          <button
            type="button"
            class="rounded-lg border border-border px-2.5 py-1.5 text-[9px] font-medium hover:bg-header disabled:opacity-40"
            :disabled="busy || item.status !== 'ready'"
            @click="toggleRetain(item)"
          >
            <i
              :class="item.retained ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'"
              class="mr-1"
              aria-hidden="true"
            ></i
            >{{ item.retained ? $t('agent.files.unretain') : $t('agent.files.retain') }}
          </button>
          <a
            class="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground"
            :class="item.status === 'ready' ? '' : 'pointer-events-none opacity-40'"
            :href="downloadUrl(item)"
            :title="$t('agent.files.download')"
            ><i class="fa-solid fa-download text-[9px]" aria-hidden="true"></i
          ></a>
        </article>
      </template>
    </RecycleScroller>

    <footer v-if="nextCursor" class="shrink-0 border-t border-border/70 p-2 text-center">
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 text-[10px] hover:bg-header"
        :disabled="busy"
        @click="loadMore"
      >
        {{ $t('agent.files.loadMore') }}
      </button>
    </footer>
  </section>
</template>
