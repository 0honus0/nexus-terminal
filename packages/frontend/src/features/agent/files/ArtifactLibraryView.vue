<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { RecycleScroller } from 'vue-virtual-scroller';
  import { BaseListboxSelect, type BaseListboxOption } from '@/foundation/ui';
  import type {
    AgentAppSummaryDto,
    AgentArtifactRefDto,
    AgentArtifactCleanupPreviewDto,
    AgentArtifactStorageSummaryDto,
  } from '../api/agent-api';
  import { agentApi, formatAgentApiError, toAgentApiError } from '../api/agent-api';

  type ArtifactFileKind = 'image' | 'document' | 'code' | 'archive' | 'media' | 'other';
  type ArtifactFileKindFilter = 'all' | ArtifactFileKind;

  const props = defineProps<{ apps: AgentAppSummaryDto[] }>();
  const { t } = useI18n();

  const appOptions = computed<BaseListboxOption[]>(() => [
    { value: '', label: t('agent.files.allApps'), triggerLabel: t('agent.files.filterLabels.app') },
    ...props.apps.map((app) => ({ value: app.id, label: app.displayName })),
  ]);

  const appNames = computed(() => new Map(props.apps.map((app) => [app.id, app.displayName])));

  const retentionOptions = computed<BaseListboxOption[]>(() => [
    { value: 'all', label: t('agent.files.allRetention'), triggerLabel: t('agent.files.filterLabels.status') },
    { value: 'retained', label: t('agent.files.retained') },
    { value: 'unretained', label: t('agent.files.unretained') },
  ]);

  const fileKindOptions = computed<BaseListboxOption[]>(() => [
    { value: 'all', label: t('agent.files.kind.all'), triggerLabel: t('agent.files.filterLabels.type') },
    { value: 'image', label: t('agent.files.kind.image') },
    { value: 'document', label: t('agent.files.kind.document') },
    { value: 'code', label: t('agent.files.kind.code') },
    { value: 'archive', label: t('agent.files.kind.archive') },
    { value: 'media', label: t('agent.files.kind.media') },
    { value: 'other', label: t('agent.files.kind.other') },
  ]);

  const kindToneClasses: Record<ArtifactFileKind, { icon: string; badge: string }> = {
    image: {
      icon: 'border-primary/20 bg-primary/10 text-primary',
      badge: 'bg-primary/10 text-primary ',
    },
    document: {
      icon: 'border-info/20 bg-info/10 text-info',
      badge: 'bg-info/10 text-info ',
    },
    code: {
      icon: 'border-success/20 bg-success/10 text-success',
      badge: 'bg-success/10 text-success ',
    },
    archive: {
      icon: 'border-warning/20 bg-warning/10 text-warning',
      badge: 'bg-warning/10 text-warning ',
    },
    media: {
      icon: 'border-error/20 bg-error/10 text-error',
      badge: 'bg-error/10 text-error ',
    },
    other: {
      icon: 'border-border bg-header text-text-secondary',
      badge: 'bg-header text-text-secondary',
    },
  };

  const items = ref<AgentArtifactRefDto[]>([]);
  const nextCursor = ref<string | null>(null);
  const storage = ref<AgentArtifactStorageSummaryDto | null>(null);
  const cleanupPreview = ref<AgentArtifactCleanupPreviewDto | null>(null);
  const deleteTarget = ref<AgentArtifactRefDto | null>(null);
  const query = ref('');
  const appId = ref('');
  const retained = ref<'all' | 'retained' | 'unretained'>('all');
  const kind = ref<ArtifactFileKindFilter>('all');
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');
  const deleteNotice = ref('');

  const bytes = (value: number): string => {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  };

  const storageUsagePercent = computed(() => {
    if (!storage.value || storage.value.limitBytes <= 0) return 0;
    return Math.min(100, Math.round((storage.value.totalBytes / storage.value.limitBytes) * 100));
  });

  const availableBytes = computed(() =>
    storage.value ? Math.max(0, storage.value.limitBytes - storage.value.totalBytes) : 0,
  );

  const hasFilters = computed(
    () => Boolean(query.value.trim()) || Boolean(appId.value) || retained.value !== 'all' || kind.value !== 'all',
  );

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'));

  const filters = () => ({
    ...(query.value.trim() ? { q: query.value.trim() } : {}),
    ...(appId.value ? { appId: appId.value } : {}),
    ...(retained.value === 'all' ? {} : { retained: retained.value === 'retained' }),
    ...(kind.value === 'all' ? {} : { kind: kind.value }),
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

  const resetFilters = (): void => {
    query.value = '';
    appId.value = '';
    retained.value = 'all';
    kind.value = 'all';
    void load();
  };

  const toggleRetain = async (artifact: AgentArtifactRefDto): Promise<void> => {
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

  const requestDelete = (artifact: AgentArtifactRefDto): void => {
    deleteTarget.value = artifact;
    error.value = '';
    deleteNotice.value = '';
  };

  const confirmDelete = async (): Promise<void> => {
    const target = deleteTarget.value;
    if (!target || busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    deleteNotice.value = '';
    try {
      await agentApi.deleteArtifact(target);
      deleteTarget.value = null;
      await load();
      deleteNotice.value = t('agent.files.deleteDone', { name: target.originalName });
    } catch (cause) {
      const apiError = toAgentApiError(cause);
      if (['STATE_CONFLICT', 'NOT_FOUND', 'ARTIFACT_PROTECTED'].includes(apiError.code)) {
        await load();
      }
      if (apiError.code === 'STATE_CONFLICT') error.value = t('agent.files.deleteConflict');
      else if (apiError.code === 'NOT_FOUND') error.value = t('agent.files.deleteNotFound');
      else if (apiError.code === 'ARTIFACT_PROTECTED') error.value = t('agent.files.deleteProtected');
      else error.value = explain(cause);
      deleteTarget.value = null;
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

  const downloadUrl = (artifact: AgentArtifactRefDto): string =>
    `/api/v1/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}/content`;

  const extensionOf = (name: string): string => {
    const filename = name.split('/').at(-1) ?? name;
    const index = filename.lastIndexOf('.');
    if (index <= 0 || index === filename.length - 1) return '';
    return filename
      .slice(index + 1)
      .slice(0, 8)
      .toUpperCase();
  };

  const kindForArtifact = (artifact: AgentArtifactRefDto): ArtifactFileKind => {
    const mediaType = artifact.mediaType.toLowerCase();
    const extension = extensionOf(artifact.originalName).toLowerCase();
    if (mediaType.startsWith('image/')) return 'image';
    if (mediaType.startsWith('audio/') || mediaType.startsWith('video/')) return 'media';
    if (['zip', '7z', 'rar', 'tar', 'tgz', 'gz', 'bz2', 'xz'].includes(extension)) return 'archive';
    if (
      [
        'application/zip',
        'application/x-7z-compressed',
        'application/vnd.rar',
        'application/x-rar-compressed',
        'application/x-tar',
        'application/gzip',
        'application/x-gzip',
        'application/x-bzip2',
        'application/x-xz',
      ].includes(mediaType)
    )
      return 'archive';
    if (
      [
        'js',
        'jsx',
        'ts',
        'tsx',
        'vue',
        'py',
        'go',
        'rs',
        'java',
        'c',
        'h',
        'cpp',
        'hpp',
        'cs',
        'rb',
        'php',
        'sh',
        'sql',
        'html',
        'css',
        'scss',
        'less',
        'json',
        'jsonl',
        'yaml',
        'yml',
        'toml',
        'xml',
      ].includes(extension)
    )
      return 'code';
    if (
      [
        'application/json',
        'application/ld+json',
        'application/xml',
        'text/xml',
        'text/html',
        'text/css',
        'text/javascript',
        'application/javascript',
        'application/sql',
        'application/x-yaml',
        'text/yaml',
        'text/x-python',
        'text/x-shellscript',
      ].includes(mediaType)
    )
      return 'code';
    if (
      ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'rtf', 'odt', 'ods', 'epub'].includes(
        extension,
      )
    )
      return 'document';
    if (
      mediaType === 'application/pdf' ||
      mediaType === 'text/csv' ||
      mediaType === 'text/markdown' ||
      mediaType.includes('wordprocessingml') ||
      mediaType.includes('spreadsheetml') ||
      mediaType.includes('presentationml') ||
      mediaType.includes('msword') ||
      mediaType.includes('ms-excel') ||
      mediaType.includes('ms-powerpoint') ||
      mediaType.includes('opendocument')
    )
      return 'document';
    return 'other';
  };

  const iconForKind = (value: ArtifactFileKind): string => {
    if (value === 'image') return 'fa-image';
    if (value === 'document') return 'fa-file-lines';
    if (value === 'code') return 'fa-file-code';
    if (value === 'archive') return 'fa-file-zipper';
    if (value === 'media') return 'fa-circle-play';
    return 'fa-file';
  };

  const appName = (artifact: AgentArtifactRefDto): string => appNames.value.get(artifact.appId) ?? artifact.appId;

  const formatDate = (value: number): string => new Date(value * 1000).toLocaleDateString();

  const statusTone = (status: AgentArtifactRefDto['status']): string => {
    if (status === 'ready') return 'bg-success/10 text-success';
    if (status === 'staging') return 'bg-warning/10 text-warning';
    if (status === 'unavailable') return 'bg-error/10 text-error';
    return 'bg-header text-text-secondary';
  };

  onMounted(load);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <header class="shrink-0 border-b border-border/70 bg-background px-4 py-3 sm:px-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-[11px] text-text-secondary"
          >
            <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold tracking-tight text-foreground">{{ $t('agent.hub.files') }}</h2>
            <p class="mt-0.5 max-w-xl text-[11px] leading-4 text-text-secondary">
              {{ $t('agent.files.libraryHint') }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <span v-if="deleteNotice" class="rounded-xl bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success">
            <i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
            {{ deleteNotice }}
          </span>

          <span v-if="notice" class="rounded-xl bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success">
            <i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
            {{ $t('agent.files.cleanupDone', { count: notice }) }}
          </span>

          <div
            v-if="deleteTarget"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-error/30 bg-error/6 px-3 py-1.5 text-[11px] shadow-2xs"
          >
            <i class="fa-solid fa-trash-can text-error" aria-hidden="true"></i>
            <span class="font-medium text-foreground">
              {{
                $t('agent.files.deletePreview', {
                  name: deleteTarget.originalName,
                  bytes: bytes(deleteTarget.sizeBytes),
                })
              }}
            </span>
            <div class="flex items-center gap-1 border-l border-error/20 pl-2">
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-text-secondary transition-colors hover:bg-header hover:text-foreground"
                :disabled="busy"
                @click="deleteTarget = null"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-lg bg-error px-2.5 py-1 font-semibold text-white transition-colors hover:bg-error/90 disabled:opacity-50"
                :disabled="busy"
                @click="confirmDelete"
              >
                {{ $t('agent.files.deleteConfirm') }}
              </button>
            </div>
          </div>

          <button
            v-if="!cleanupPreview"
            type="button"
            class="flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 text-[11px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:bg-header hover:text-foreground disabled:opacity-50"
            :disabled="busy"
            @click="previewCleanup"
          >
            <i class="fa-solid fa-broom text-[9px]" aria-hidden="true"></i>
            {{ $t('agent.files.cleanup') }}
          </button>

          <div
            v-else
            class="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/8 px-3 py-1.5 text-[11px] shadow-2xs"
          >
            <i class="fa-solid fa-triangle-exclamation text-warning" aria-hidden="true"></i>
            <span class="font-medium text-foreground">
              {{
                $t('agent.files.cleanupPreview', {
                  count: cleanupPreview.selectedCount,
                  bytes: bytes(cleanupPreview.selectedBytes),
                  protected: cleanupPreview.protectedCount,
                })
              }}
            </span>
            <div class="flex items-center gap-1 border-l border-warning/25 pl-2">
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-text-secondary transition-colors hover:bg-header hover:text-foreground"
                @click="cleanupPreview = null"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-lg bg-error px-2.5 py-1 font-semibold text-white transition-colors hover:bg-error/90 disabled:opacity-50"
                :disabled="busy"
                @click="confirmCleanup"
              >
                {{ $t('agent.files.cleanupConfirm') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="storage" class="mt-3 border-y border-border/60 bg-card/30 px-3 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-44 flex-1">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                {{ $t('agent.files.storageOverview') }}
              </span>
              <span class="text-[11px] font-medium text-foreground">
                {{ bytes(storage.totalBytes) }} / {{ bytes(storage.limitBytes) }}
              </span>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-header">
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-300"
                :style="{ width: `${storageUsagePercent}%` }"
              ></div>
            </div>
            <div class="mt-1.5 text-[11px] text-text-secondary">
              {{ $t('agent.files.storageUsedPercent', { percent: storageUsagePercent }) }}
            </div>
          </div>

          <div class="grid min-w-full grid-cols-3 gap-2 sm:min-w-[360px] sm:flex-1">
            <div class="border-l border-border/60 px-3 py-1.5">
              <div class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {{ $t('agent.files.protected') }}
              </div>
              <div class="mt-1 text-[11px] font-semibold text-foreground">{{ bytes(storage.protectedBytes) }}</div>
            </div>
            <div class="border-l border-border/60 px-3 py-1.5">
              <div class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {{ $t('agent.files.reclaimable') }}
              </div>
              <div class="mt-1 text-[11px] font-semibold text-foreground">{{ bytes(storage.reclaimableBytes) }}</div>
            </div>
            <div class="border-l border-border/60 px-3 py-1.5">
              <div class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {{ $t('agent.files.available') }}
              </div>
              <div class="mt-1 text-[11px] font-semibold text-foreground">{{ bytes(availableBytes) }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2 border-t border-border/55 pt-2">
        <div
          class="group flex h-10 min-w-0 flex-1 items-center rounded-xl border border-border/65 bg-gradient-to-b from-card/80 to-background px-1.5 shadow-xs transition-[border-color,box-shadow] hover:border-border-hover focus-within:border-primary/30 focus-within:shadow-xs focus-within:ring-2 focus-within:ring-primary/15"
        >
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-header/45 text-text-secondary/80 transition-colors group-focus-within:bg-primary/8 group-focus-within:text-primary"
          >
            <i class="fa-solid fa-magnifying-glass text-[9px]" aria-hidden="true"></i>
          </span>
          <input
            v-model="query"
            type="search"
            data-no-highlight
            class="h-full min-w-[8rem] flex-1 bg-transparent px-2.5 text-[11px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-text-secondary/45"
            :placeholder="$t('agent.files.search')"
            @keydown.enter="load"
          />

          <div class="flex shrink-0 items-center gap-0.5 rounded-lg bg-background/35 p-0.5">
            <div class="w-[4.75rem]">
              <BaseListboxSelect
                v-model="kind"
                :options="fileKindOptions"
                size="sm"
                :highlight="false"
                :trigger-class="
                  [
                    '!h-8 !rounded-lg !border-0 !px-2.5 !shadow-none !ring-0 transition-colors',
                    kind === 'all'
                      ? '!bg-transparent !text-text-secondary hover:!bg-header/55 focus:!bg-header/55'
                      : '!bg-header/70 !font-medium !text-foreground hover:!bg-header focus:!bg-header',
                  ].join(' ')
                "
                @update:model-value="load"
              />
            </div>
            <div class="w-[4.75rem]">
              <BaseListboxSelect
                v-model="appId"
                :options="appOptions"
                size="sm"
                :highlight="false"
                :trigger-class="
                  [
                    '!h-8 !rounded-lg !border-0 !px-2.5 !shadow-none !ring-0 transition-colors',
                    appId === ''
                      ? '!bg-transparent !text-text-secondary hover:!bg-header/55 focus:!bg-header/55'
                      : '!bg-header/70 !font-medium !text-foreground hover:!bg-header focus:!bg-header',
                  ].join(' ')
                "
                @update:model-value="load"
              />
            </div>
            <div class="w-[4.75rem]">
              <BaseListboxSelect
                v-model="retained"
                :options="retentionOptions"
                size="sm"
                :highlight="false"
                :trigger-class="
                  [
                    '!h-8 !rounded-lg !border-0 !px-2.5 !shadow-none !ring-0 transition-colors',
                    retained === 'all'
                      ? '!bg-transparent !text-text-secondary hover:!bg-header/55 focus:!bg-header/55'
                      : '!bg-header/70 !font-medium !text-foreground hover:!bg-header focus:!bg-header',
                  ].join(' ')
                "
                @update:model-value="load"
              />
            </div>
            <button
              type="button"
              class="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] text-text-secondary transition-[background-color,color,transform] hover:bg-primary/10 hover:text-primary active:scale-95 disabled:opacity-50"
              :disabled="busy"
              :title="$t('agent.files.searchAction')"
              @click="load"
            >
              <i class="fa-solid fa-arrow-right text-[8px]" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <button
          v-if="hasFilters"
          type="button"
          class="flex h-8 shrink-0 items-center gap-1.5 px-1 text-[11px] font-medium text-text-secondary transition-colors hover:text-foreground disabled:opacity-50"
          :disabled="busy"
          @click="resetFilters"
        >
          <i class="fa-solid fa-rotate-left text-[8px]" aria-hidden="true"></i>
          <span class="hidden sm:inline">{{ $t('agent.files.resetFilters') }}</span>
        </button>
      </div>

      <p v-if="error" class="mt-2 rounded-xl border border-error/20 bg-error/8 px-3 py-2 text-[11px] text-error">
        <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ error }}
      </p>
    </header>

    <div v-if="items.length > 0" class="shrink-0 border-b border-border/60 bg-card/30 px-4">
      <div
        class="grid h-9 grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_5.5rem]"
      >
        <span>{{ $t('agent.files.columns.name') }}</span>
        <span class="hidden sm:block">{{ $t('agent.files.columns.source') }}</span>
        <span class="hidden sm:block">{{ $t('agent.files.columns.size') }}</span>
        <span>{{ $t('agent.files.columns.status') }}</span>
        <span class="text-right">{{ $t('agent.files.columns.actions') }}</span>
      </div>
    </div>

    <div
      v-if="items.length === 0 && !busy"
      class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center"
    >
      <div class="relative">
        <div class="absolute -inset-5 rounded-full bg-primary/8 blur-xl"></div>
        <div
          class="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-lg text-text-secondary shadow-sm"
        >
          <i
            :class="hasFilters ? 'fa-solid fa-filter-circle-xmark' : 'fa-regular fa-folder-open'"
            aria-hidden="true"
          ></i>
        </div>
      </div>
      <p class="mt-4 text-xs font-semibold text-foreground">{{ $t('agent.files.emptyTitle') }}</p>
      <p class="mt-1 max-w-xs text-[11px] leading-4 text-text-secondary">{{ $t('agent.files.empty') }}</p>
      <button
        v-if="hasFilters"
        type="button"
        class="mt-3 rounded-xl border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-header"
        @click="resetFilters"
      >
        {{ $t('agent.files.resetFilters') }}
      </button>
    </div>

    <RecycleScroller v-else class="min-h-0 flex-1 overflow-y-auto px-4" :items="items" :item-size="58" key-field="id">
      <template #default="{ item }">
        <article
          class="group grid h-[58px] grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 border-b border-border/55 px-2 transition-colors hover:bg-header/45 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_5.5rem]"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px]"
              :class="kindToneClasses[kindForArtifact(item)].icon"
            >
              <i class="fa-solid" :class="iconForKind(kindForArtifact(item))" aria-hidden="true"></i>
            </div>
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate text-[11px] font-semibold text-foreground" :title="item.originalName">
                  {{ item.originalName }}
                </span>
                <span
                  v-if="extensionOf(item.originalName)"
                  class="shrink-0 rounded bg-header px-1 py-0.5 text-[11px] font-semibold tracking-wide text-text-secondary"
                >
                  {{ extensionOf(item.originalName) }}
                </span>
                <i
                  v-if="item.retained"
                  class="fa-solid fa-bookmark shrink-0 text-[8px] text-primary"
                  :title="$t('agent.files.retained')"
                  aria-hidden="true"
                ></i>
              </div>
              <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
                <span class="max-w-44 truncate" :title="item.mediaType">{{ item.mediaType }}</span>
                <span aria-hidden="true">·</span>
                <span class="shrink-0">{{ formatDate(item.createdAt) }}</span>
              </div>
            </div>
          </div>

          <div class="hidden min-w-0 truncate text-[11px] text-text-secondary sm:block" :title="appName(item)">
            {{ appName(item) }}
          </div>
          <div class="hidden text-[11px] tabular-nums text-text-secondary sm:block">{{ bytes(item.sizeBytes) }}</div>
          <div>
            <span class="inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium" :class="statusTone(item.status)">
              {{ $t(`agent.files.status.${item.status}`) }}
            </span>
          </div>
          <div class="flex items-center justify-end gap-0.5">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
              :disabled="busy || item.status !== 'ready'"
              :title="item.retained ? $t('agent.files.unretain') : $t('agent.files.retain')"
              @click="toggleRetain(item)"
            >
              <i :class="item.retained ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-error/10 hover:text-error disabled:opacity-50"
              :disabled="busy"
              :title="$t('agent.files.delete')"
              @click="requestDelete(item)"
            >
              <i class="fa-regular fa-trash-can text-[9px]" aria-hidden="true"></i>
            </button>
            <a
              class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-header hover:text-foreground"
              :class="item.status === 'ready' ? '' : 'pointer-events-none opacity-35'"
              :href="downloadUrl(item)"
              :title="$t('agent.files.download')"
            >
              <i class="fa-solid fa-arrow-down-to-line text-[9px]" aria-hidden="true"></i>
            </a>
          </div>
        </article>
      </template>
    </RecycleScroller>

    <footer v-if="nextCursor" class="shrink-0 border-t border-border/60 bg-card/35 p-2 text-center">
      <button
        type="button"
        class="rounded-xl px-4 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground"
        :disabled="busy"
        @click="loadMore"
      >
        <i class="fa-solid fa-chevron-down mr-1 text-[8px]" aria-hidden="true"></i>
        {{ $t('agent.files.loadMore') }}
      </button>
    </footer>
  </section>
</template>
