<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';
  import type { DatabasePreviewColumn, DatabasePreviewController } from '../model/databasePreview';
  import { openDatabasePreview } from '../model/databasePreview';
  import type { PreviewFile } from '../model/preview';

  const props = withDefaults(
    defineProps<{
      file: PreviewFile;
      session: FilePreviewSessionController;
      active?: boolean;
    }>(),
    { active: true },
  );
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();

  const ROWS_PER_PAGE = 200;
  const previewRoot = ref<HTMLElement | null>(null);
  const scroller = ref<HTMLElement | null>(null);
  const database = shallowRef<DatabasePreviewController | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  const activeTable = ref('');
  const columns = ref<DatabasePreviewColumn[]>([]);
  const rows = ref<string[][]>([]);
  const totalRows = ref(0);
  const page = ref(1);
  const searchOpen = ref(false);
  const searchInput = ref('');
  const appliedSearch = ref('');
  const searchIndex = ref(-1);
  const searchBusy = ref(false);
  let databaseToken = 0;
  let searchTimer: number | undefined;

  const tables = computed(() => database.value?.tables ?? []);
  const pageCount = computed(() => Math.max(1, Math.ceil(totalRows.value / ROWS_PER_PAGE)));
  const pageStart = computed(() => (page.value - 1) * ROWS_PER_PAGE);
  const pageRangeStart = computed(() => (rows.value.length ? pageStart.value + 1 : 0));
  const pageRangeEnd = computed(() => pageStart.value + rows.value.length);
  const subtitle = computed(() =>
    activeTable.value
      ? t('fileManager.preview.databaseMeta', {
          table: activeTable.value,
          rows: totalRows.value,
          columns: columns.value.length,
        })
      : t('fileManager.preview.database'),
  );

  const focusPreview = (): void => {
    void nextTick(() => previewRoot.value?.focus({ preventScroll: true }));
  };

  const loadPage = (nextPage = page.value): void => {
    const current = database.value;
    if (!current || !activeTable.value) {
      rows.value = [];
      totalRows.value = 0;
      return;
    }
    const requestedPage = Math.max(1, Math.trunc(nextPage));
    const result = current.page(
      activeTable.value,
      (requestedPage - 1) * ROWS_PER_PAGE,
      ROWS_PER_PAGE,
      appliedSearch.value,
    );
    totalRows.value = result.totalRows;
    page.value = Math.min(requestedPage, pageCount.value);
    rows.value =
      page.value === requestedPage || totalRows.value === 0
        ? result.rows
        : current.page(activeTable.value, (page.value - 1) * ROWS_PER_PAGE, ROWS_PER_PAGE, appliedSearch.value).rows;
    scroller.value?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  };

  const selectTable = (name: string): void => {
    const current = database.value;
    if (!current || name === activeTable.value) return;
    activeTable.value = name;
    columns.value = current.columns(name);
    page.value = 1;
    searchIndex.value = appliedSearch.value ? 0 : -1;
    loadPage(1);
    focusPreview();
  };

  const openCurrentDatabase = async (): Promise<void> => {
    const token = ++databaseToken;
    loading.value = true;
    error.value = null;
    database.value?.close();
    database.value = null;
    rows.value = [];
    columns.value = [];
    totalRows.value = 0;
    try {
      const opened = await openDatabasePreview(props.file.bytes);
      if (token !== databaseToken) {
        opened.close();
        return;
      }
      database.value = opened;
      activeTable.value = opened.tables[0]?.name ?? '';
      if (activeTable.value) {
        columns.value = opened.columns(activeTable.value);
        loadPage(1);
      }
    } catch (cause) {
      if (token === databaseToken) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === databaseToken) loading.value = false;
    }
  };

  const applySearch = (query: string): void => {
    appliedSearch.value = query.trim();
    searchIndex.value = appliedSearch.value ? 0 : -1;
    page.value = 1;
    loadPage(1);
    if (appliedSearch.value && totalRows.value === 0) searchIndex.value = -1;
    searchBusy.value = false;
  };

  const updateSearch = (query: string): void => {
    searchInput.value = query;
    searchBusy.value = true;
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => applySearch(searchInput.value), 160);
  };

  const revealSearchIndex = (index: number): void => {
    if (!appliedSearch.value || totalRows.value <= 0) {
      searchIndex.value = -1;
      return;
    }
    searchIndex.value = ((index % totalRows.value) + totalRows.value) % totalRows.value;
    const nextPage = Math.floor(searchIndex.value / ROWS_PER_PAGE) + 1;
    if (nextPage !== page.value) loadPage(nextPage);
    void nextTick(() => {
      const rowIndex = searchIndex.value % ROWS_PER_PAGE;
      scroller.value
        ?.querySelector<HTMLElement>(`[data-database-row-index="${rowIndex}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    });
  };

  const closeSearch = (): void => {
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    searchTimer = undefined;
    searchBusy.value = false;
    searchOpen.value = false;
    searchInput.value = '';
    applySearch('');
    focusPreview();
  };

  const cellMatchesSearch = (cell: string): boolean => {
    const query = appliedSearch.value.toLocaleLowerCase();
    return Boolean(query && cell.toLocaleLowerCase().includes(query));
  };

  const isActiveSearchRow = (rowIndex: number): boolean =>
    searchIndex.value >= 0 && pageStart.value + rowIndex === searchIndex.value;

  const handleGridKeydown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,button,select,textarea')) return;
    if (event.key === 'PageUp') {
      event.preventDefault();
      loadPage(page.value - 1);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      loadPage(page.value + 1);
    }
  };

  watch(() => props.file.bytes, openCurrentDatabase, { immediate: true });
  onBeforeUnmount(() => {
    databaseToken += 1;
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    database.value?.close();
  });
</script>

<template>
  <FilePreviewDialog :file="file" :session="session" :subtitle="subtitle" :active="active" @close="emit('close')">
    <template #toolbar>
      <PreviewSearchBar
        :open="searchOpen"
        :query="searchInput"
        :current="searchIndex >= 0 ? searchIndex + 1 : 0"
        :total="appliedSearch ? totalRows : 0"
        :busy="searchBusy"
        :active="active"
        @open="searchOpen = true"
        @close="closeSearch"
        @update:query="updateSearch"
        @previous="revealSearchIndex(searchIndex - 1)"
        @next="revealSearchIndex(searchIndex + 1)"
      />
    </template>

    <div
      ref="previewRoot"
      data-testid="database-preview"
      class="flex h-full min-h-0 w-full flex-col overflow-hidden outline-none"
      tabindex="-1"
      @keydown="handleGridKeydown"
    >
      <div v-if="loading" class="grid min-h-0 flex-1 place-items-center text-sm text-text-secondary">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
      </div>

      <div
        v-else-if="error"
        data-testid="database-preview-error"
        role="alert"
        class="m-4 rounded border border-error/40 bg-error/10 p-4 text-sm text-error"
      >
        <p>{{ t('fileManager.preview.databaseLoadFailed') }}</p>
        <p class="mt-1 break-words text-xs opacity-80">{{ error }}</p>
      </div>

      <div
        v-else-if="!tables.length"
        data-testid="database-preview-empty"
        class="grid min-h-0 flex-1 place-items-center p-6 text-sm text-text-secondary"
      >
        {{ t('fileManager.preview.databaseNoTables') }}
      </div>

      <template v-else>
        <div
          ref="scroller"
          data-testid="database-scroll-container"
          role="region"
          :aria-label="t('fileManager.preview.database')"
          class="database-scroll-container min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <table class="database-grid min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th
                  class="sticky left-0 top-0 z-30 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-2 text-right font-medium text-text-secondary"
                >
                  #
                </th>
                <th
                  v-for="column in columns"
                  :key="column.name"
                  class="sticky top-0 z-20 min-w-32 max-w-80 border-b border-r border-border bg-header px-2 py-2 text-left font-medium"
                  :title="column.type || column.name"
                >
                  <span class="block truncate">{{ column.name }}</span>
                  <span v-if="column.type" class="block truncate text-[10px] font-normal text-text-alt">{{
                    column.type
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in rows"
                :key="pageStart + rowIndex"
                data-testid="database-data-row"
                :data-database-row-index="rowIndex"
                :class="{ 'database-search-active': isActiveSearchRow(rowIndex) }"
              >
                <th
                  class="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-1.5 text-right font-normal text-text-secondary"
                >
                  {{ pageStart + rowIndex + 1 }}
                </th>
                <td
                  v-for="(cell, columnIndex) in row"
                  :key="columnIndex"
                  class="max-w-80 whitespace-pre-wrap break-words border-b border-r border-border px-2 py-1.5 align-top"
                  :class="{ 'database-search-match': cellMatchesSearch(cell) }"
                  :title="cell"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          data-testid="database-pagination"
          class="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-header px-2 py-1.5 text-xs sm:gap-3 sm:px-3"
        >
          <span data-testid="database-page-range" class="min-w-0 truncate text-text-secondary">
            {{
              t('fileManager.preview.databasePageRange', {
                start: pageRangeStart,
                end: pageRangeEnd,
                total: totalRows,
              })
            }}
          </span>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-testid="database-previous-page"
              class="flex h-11 w-11 items-center justify-center rounded border border-border text-base text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:w-auto sm:px-2 sm:py-1 sm:text-xs"
              :disabled="page <= 1"
              :aria-label="t('fileManager.preview.databasePreviousPage')"
              @click="loadPage(page - 1)"
            >
              ‹
            </button>
            <span class="text-text-secondary">
              {{ t('fileManager.preview.databasePage') }}
              <strong data-testid="database-current-page" class="font-medium text-foreground">{{ page }}</strong>
              /
              <strong data-testid="database-page-count" class="font-medium text-foreground">{{ pageCount }}</strong>
            </span>
            <button
              type="button"
              data-testid="database-next-page"
              class="flex h-11 w-11 items-center justify-center rounded border border-border text-base text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:w-auto sm:px-2 sm:py-1 sm:text-xs"
              :disabled="page >= pageCount"
              :aria-label="t('fileManager.preview.databaseNextPage')"
              @click="loadPage(page + 1)"
            >
              ›
            </button>
          </div>
        </div>

        <div
          data-testid="database-table-tabs"
          role="tablist"
          :aria-label="t('fileManager.preview.databaseTables')"
          class="database-table-tabs flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-header px-2 py-1.5"
        >
          <button
            v-for="table in tables"
            :key="table.name"
            type="button"
            role="tab"
            class="min-h-11 max-w-56 shrink-0 truncate rounded border px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-primary sm:min-h-0"
            :class="
              table.name === activeTable
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border bg-background text-text-secondary hover:bg-border hover:text-foreground'
            "
            :title="table.name"
            :aria-selected="table.name === activeTable"
            @click="selectTable(table.name)"
          >
            {{ table.name }}
          </button>
        </div>

        <PreviewHorizontalScrollbar
          :target="scroller"
          test-id="database-horizontal-scrollbar"
          :active="active"
          :label="t('fileManager.preview.horizontalScroll')"
        />
      </template>
    </div>
  </FilePreviewDialog>
</template>

<style scoped>
  .database-grid td.database-search-match {
    background: color-mix(in srgb, var(--color-warning) 35%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-warning) 55%, transparent);
  }

  .database-grid tr.database-search-active > td {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  }

  .database-grid tr.database-search-active > td.database-search-match {
    background: color-mix(in srgb, var(--color-primary) 32%, transparent);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 75%, transparent);
  }

  .database-scroll-container {
    scrollbar-gutter: stable;
    scrollbar-width: auto;
  }

  .database-scroll-container::-webkit-scrollbar {
    width: 13px;
    height: 13px;
  }

  .database-scroll-container::-webkit-scrollbar-track {
    background: color-mix(in srgb, var(--color-header) 75%, transparent);
  }

  .database-scroll-container::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-text-secondary) 62%, transparent);
    background-clip: padding-box;
  }

  .database-table-tabs {
    scrollbar-width: thin;
  }
</style>
