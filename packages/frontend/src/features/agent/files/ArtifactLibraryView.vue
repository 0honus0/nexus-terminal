<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { RecycleScroller } from 'vue-virtual-scroller';
  import type {
    AgentAppSummary,
    AgentArtifactRef,
    ArtifactCleanupPreview,
    ArtifactStorageSummary,
  } from '../api/agent-api';
  import { agentApi } from '../api/agent-api';

  defineProps<{ apps: AgentAppSummary[] }>();

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

  const explain = (cause: unknown): string => {
    if (cause && typeof cause === 'object' && 'response' in cause) {
      const response = (cause as { response?: { data?: { error?: { message?: string; code?: string } } } }).response;
      return response?.data?.error?.message || response?.data?.error?.code || 'AGENT_REQUEST_FAILED';
    }
    return cause instanceof Error ? cause.message : 'AGENT_REQUEST_FAILED';
  };

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
    <header class="shrink-0 border-b border-border bg-card p-3">
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="query"
          type="search"
          class="min-w-48 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          :placeholder="$t('agent.files.search')"
          @keydown.enter="load"
        />
        <select v-model="appId" class="rounded-md border border-border bg-background px-2 py-2 text-sm" @change="load">
          <option value="">{{ $t('agent.files.allApps') }}</option>
          <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.displayName }}</option>
        </select>
        <select
          v-model="retained"
          class="rounded-md border border-border bg-background px-2 py-2 text-sm"
          @change="load"
        >
          <option value="all">{{ $t('agent.files.allRetention') }}</option>
          <option value="retained">{{ $t('agent.files.retained') }}</option>
          <option value="unretained">{{ $t('agent.files.unretained') }}</option>
        </select>
        <button
          type="button"
          class="rounded-md border border-border px-3 py-2 text-sm hover:bg-header"
          :disabled="busy"
          @click="load"
        >
          {{ $t('agent.files.searchAction') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-border px-3 py-2 text-sm hover:bg-header"
          :disabled="busy"
          @click="previewCleanup"
        >
          {{ $t('agent.files.cleanup') }}
        </button>
      </div>
      <div v-if="storage" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span>{{ $t('agent.files.used') }} {{ bytes(storage.totalBytes) }}</span>
        <span>{{ $t('agent.files.protected') }} {{ bytes(storage.protectedBytes) }}</span>
        <span>{{ $t('agent.files.reclaimable') }} {{ bytes(storage.reclaimableBytes) }}</span>
      </div>
      <p v-if="error" class="mt-2 text-xs text-error">{{ error }}</p>
      <p v-if="notice" class="mt-2 text-xs text-success">{{ $t('agent.files.cleanupDone', { count: notice }) }}</p>
      <div v-if="cleanupPreview" class="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <p>
          {{
            $t('agent.files.cleanupPreview', {
              count: cleanupPreview.selectedCount,
              bytes: bytes(cleanupPreview.selectedBytes),
              protected: cleanupPreview.protectedCount,
            })
          }}
        </p>
        <div class="mt-2 flex justify-end gap-2">
          <button type="button" class="rounded px-3 py-1.5 text-sm hover:bg-header" @click="cleanupPreview = null">
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded bg-error px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy"
            @click="confirmCleanup"
          >
            {{ $t('agent.files.cleanupConfirm') }}
          </button>
        </div>
      </div>
    </header>

    <RecycleScroller class="min-h-0 flex-1 overflow-y-auto" :items="items" :item-size="68" key-field="id">
      <template #default="{ item }">
        <article class="flex h-[68px] items-center gap-3 border-b border-border px-4">
          <i class="fa-regular fa-file shrink-0 text-text-secondary" aria-hidden="true"></i>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ item.originalName }}</div>
            <div class="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-text-secondary">
              <span>{{ item.appId }}</span>
              <span>{{ bytes(item.sizeBytes) }}</span>
              <span>{{ item.mediaType }}</span>
              <span>{{ item.status }}</span>
            </div>
          </div>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs hover:bg-header"
            :disabled="busy || item.status !== 'ready'"
            @click="toggleRetain(item)"
          >
            {{ item.retained ? $t('agent.files.unretain') : $t('agent.files.retain') }}
          </button>
          <a
            class="rounded px-2 py-1 text-xs hover:bg-header"
            :class="item.status === 'ready' ? '' : 'pointer-events-none opacity-40'"
            :href="downloadUrl(item)"
            >{{ $t('agent.files.download') }}</a
          >
        </article>
      </template>
    </RecycleScroller>

    <footer v-if="nextCursor" class="shrink-0 border-t border-border p-2 text-center">
      <button type="button" class="rounded-md px-3 py-1.5 text-xs hover:bg-header" :disabled="busy" @click="loadMore">
        {{ $t('agent.files.loadMore') }}
      </button>
    </footer>
  </section>
</template>
