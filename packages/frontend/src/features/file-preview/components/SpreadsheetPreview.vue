<script setup lang="ts">
  import { computed, nextTick, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';
  import type { PreviewFile } from '../model/preview';
  import { parseSpreadsheetPreview, type SpreadsheetSearchMatch } from '../model/spreadsheetPreview';

  const props = withDefaults(
    defineProps<{
      file: PreviewFile;
      session: FilePreviewSessionController;
      rowsPerPage?: number;
      maxColumns?: number;
      active?: boolean;
    }>(),
    { rowsPerPage: 500, maxColumns: 100, active: true },
  );
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();

  const previewRoot = ref<HTMLElement | null>(null);
  const scroller = ref<HTMLElement | null>(null);
  const sheetIndex = ref(0);
  const page = ref(1);
  const searchOpen = ref(false);
  const search = ref('');
  const searchIndex = ref(-1);

  const rowsPerPage = computed(() => Math.min(2000, Math.max(10, Number(props.rowsPerPage) || 500)));
  const maxColumns = computed(() => Math.min(200, Math.max(5, Number(props.maxColumns) || 100)));
  const sheets = computed(() => parseSpreadsheetPreview(props.file.bytes, maxColumns.value));
  const activeSheet = computed(() => sheets.value[sheetIndex.value] ?? sheets.value[0] ?? null);
  const pageCount = computed(() =>
    activeSheet.value ? Math.max(1, Math.ceil(activeSheet.value.totalRows / rowsPerPage.value)) : 1,
  );
  const pageStart = computed(() => (page.value - 1) * rowsPerPage.value);
  const pageRows = computed(() => activeSheet.value?.page(pageStart.value, rowsPerPage.value) ?? []);
  const pageRangeStart = computed(() =>
    activeSheet.value && pageRows.value.length ? activeSheet.value.startRow + pageStart.value + 1 : 0,
  );
  const pageRangeEnd = computed(() =>
    activeSheet.value ? activeSheet.value.startRow + pageStart.value + pageRows.value.length : 0,
  );
  const columnsTruncated = computed(() =>
    Boolean(activeSheet.value && activeSheet.value.displayedColumns < activeSheet.value.totalColumns),
  );
  const subtitle = computed(() =>
    activeSheet.value
      ? t('fileManager.preview.spreadsheetMeta', {
          sheet: activeSheet.value.name,
          rows: activeSheet.value.totalRows,
          columns: activeSheet.value.totalColumns,
        })
      : t('fileManager.preview.spreadsheet'),
  );

  const searchMatches = computed<SpreadsheetSearchMatch[]>(() => {
    const query = search.value.trim();
    if (!query) return [];
    const matches: SpreadsheetSearchMatch[] = [];
    for (let index = 0; index < sheets.value.length && matches.length < 10_000; index += 1) {
      for (const match of sheets.value[index]!.search(query, 10_000 - matches.length)) {
        matches.push({ sheetIndex: index, ...match });
      }
    }
    return matches;
  });
  const activeMatch = computed(() => (searchIndex.value >= 0 ? searchMatches.value[searchIndex.value] : undefined));
  const currentSheetMatchKeys = computed(() => {
    const keys = new Set<string>();
    for (const match of searchMatches.value) {
      if (match.sheetIndex === sheetIndex.value) keys.add(`${match.rowIndex}:${match.colIndex}`);
    }
    return keys;
  });

  const focusPreview = (): void => {
    void nextTick(() => previewRoot.value?.focus({ preventScroll: true }));
  };
  const resetScroll = (): void => {
    scroller.value?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  };
  const selectPage = (nextPage: number): void => {
    page.value = Math.min(pageCount.value, Math.max(1, Math.round(nextPage)));
    resetScroll();
    focusPreview();
  };
  const previousPage = (): void => selectPage(page.value - 1);
  const nextPage = (): void => selectPage(page.value + 1);
  const selectSheet = (index: number): void => {
    if (index === sheetIndex.value) return;
    sheetIndex.value = Math.min(Math.max(index, 0), Math.max(0, sheets.value.length - 1));
    page.value = 1;
    resetScroll();
    focusPreview();
  };
  const revealMatch = (behavior: ScrollBehavior = 'smooth'): void => {
    const match = activeMatch.value;
    if (!match) return;
    sheetIndex.value = match.sheetIndex;
    page.value = Math.floor(match.rowIndex / rowsPerPage.value) + 1;
    void nextTick(() => {
      scroller.value
        ?.querySelector<HTMLElement>(
          `[data-spreadsheet-row-index="${match.rowIndex}"][data-spreadsheet-column-index="${match.colIndex}"]`,
        )
        ?.scrollIntoView({ block: 'center', inline: 'center', behavior });
    });
  };
  const activateSearchIndex = (index: number, behavior: ScrollBehavior = 'smooth'): void => {
    const count = searchMatches.value.length;
    if (!count) {
      searchIndex.value = -1;
      return;
    }
    searchIndex.value = ((index % count) + count) % count;
    revealMatch(behavior);
  };
  const moveSearch = (delta: number): void => activateSearchIndex(searchIndex.value + delta);
  const closeSearch = (): void => {
    searchOpen.value = false;
    search.value = '';
    searchIndex.value = -1;
    focusPreview();
  };
  const handleGridKeydown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,button,select,textarea')) return;
    if (event.key === 'PageUp') {
      event.preventDefault();
      previousPage();
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      nextPage();
      return;
    }
    if (!scroller.value) return;
    const verticalStep = Math.max(48, Math.round(scroller.value.clientHeight * 0.18));
    const horizontalStep = Math.max(96, Math.round(scroller.value.clientWidth * 0.18));
    let left = 0;
    let top = 0;
    if (event.key === 'ArrowUp') top = -verticalStep;
    else if (event.key === 'ArrowDown') top = verticalStep;
    else if (event.key === 'ArrowLeft') left = -horizontalStep;
    else if (event.key === 'ArrowRight') left = horizontalStep;
    else return;
    event.preventDefault();
    scroller.value.scrollBy({ left, top, behavior: 'auto' });
  };
  const isSearchMatch = (rowIndex: number, colIndex: number): boolean =>
    currentSheetMatchKeys.value.has(`${pageStart.value + rowIndex}:${colIndex}`);
  const isActiveMatch = (rowIndex: number, colIndex: number): boolean =>
    activeMatch.value?.sheetIndex === sheetIndex.value &&
    activeMatch.value.rowIndex === pageStart.value + rowIndex &&
    activeMatch.value.colIndex === colIndex;
  const columnStyle = (column: number): Record<string, string> | undefined => {
    const width = activeSheet.value?.columnWidths[column];
    return width ? { width: `${width}px`, minWidth: `${width}px` } : undefined;
  };
  const rowStyle = (row: number): Record<string, string> | undefined => {
    const height = activeSheet.value?.rowHeights[pageStart.value + row];
    return height ? { height: `${height}px` } : undefined;
  };

  watch(searchMatches, (matches) => {
    searchIndex.value = matches.length ? 0 : -1;
    if (matches.length) revealMatch('auto');
  });
  watch(sheets, (nextSheets, previousSheets) => {
    const previousName = previousSheets[sheetIndex.value]?.name;
    const matchingIndex = previousName ? nextSheets.findIndex((sheet) => sheet.name === previousName) : -1;
    sheetIndex.value =
      matchingIndex >= 0 ? matchingIndex : Math.min(sheetIndex.value, Math.max(0, nextSheets.length - 1));
    page.value = Math.min(page.value, pageCount.value);
  });
  watch(pageCount, (count) => {
    if (page.value > count) page.value = count;
  });
  onMounted(() => window.setTimeout(focusPreview, 0));
</script>

<template>
  <FilePreviewDialog :file="file" :session="session" :subtitle="subtitle" :active="active" @close="emit('close')">
    <template #toolbar>
      <PreviewSearchBar
        :open="searchOpen"
        :query="search"
        :current="searchIndex >= 0 ? searchIndex + 1 : 0"
        :total="searchMatches.length"
        :active="active"
        @open="searchOpen = true"
        @close="closeSearch"
        @update:query="search = $event"
        @previous="moveSearch(-1)"
        @next="moveSearch(1)"
      />
    </template>

    <div
      v-if="activeSheet"
      ref="previewRoot"
      data-testid="spreadsheet-preview"
      class="flex h-full min-h-0 w-full flex-col overflow-hidden outline-none"
      tabindex="-1"
      @keydown="handleGridKeydown"
    >
      <div
        ref="scroller"
        data-testid="spreadsheet-scroll-container"
        role="region"
        :aria-label="t('fileManager.preview.spreadsheet')"
        class="spreadsheet-scroll-container min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <table class="spreadsheet-preview min-w-full border-separate border-spacing-0 text-xs">
          <tbody>
            <tr
              v-for="(row, rowIndex) in pageRows"
              :key="pageStart + rowIndex"
              data-testid="spreadsheet-data-row"
              :class="{ 'spreadsheet-header-row': page === 1 && rowIndex === 0 }"
              :style="rowStyle(rowIndex)"
            >
              <th
                class="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-1.5 text-right font-normal text-text-secondary"
              >
                {{ activeSheet.startRow + pageStart + rowIndex + 1 }}
              </th>
              <td
                v-for="(cell, colIndex) in row"
                :key="colIndex"
                class="max-w-80 whitespace-pre-wrap border-b border-r border-border px-2 py-1.5 align-top"
                :class="{
                  'spreadsheet-search-match': isSearchMatch(rowIndex, colIndex),
                  'spreadsheet-search-active': isActiveMatch(rowIndex, colIndex),
                }"
                :data-spreadsheet-row-index="pageStart + rowIndex"
                :data-spreadsheet-column-index="colIndex"
                :data-search-active="isActiveMatch(rowIndex, colIndex) ? 'true' : undefined"
                :style="columnStyle(colIndex)"
                :title="cell"
              >
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>

        <div
          v-if="columnsTruncated"
          data-testid="spreadsheet-preview-limit-notice"
          role="status"
          class="sticky bottom-0 border-t border-border bg-header/95 px-4 py-2 text-xs text-text-secondary backdrop-blur"
        >
          {{
            t('fileManager.preview.spreadsheetLimited', {
              displayedColumns: activeSheet.displayedColumns,
              totalColumns: activeSheet.totalColumns,
              totalRows: activeSheet.totalRows,
            })
          }}
        </div>
      </div>

      <div
        data-testid="spreadsheet-pagination"
        class="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-header px-2 py-1.5 text-xs sm:gap-3 sm:px-3"
      >
        <span data-testid="spreadsheet-page-range" class="min-w-0 truncate text-text-secondary">
          {{
            t('fileManager.preview.spreadsheetPageRange', {
              start: pageRangeStart,
              end: pageRangeEnd,
              total: activeSheet.totalRows,
            })
          }}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="spreadsheet-previous-page"
            class="flex h-11 w-11 items-center justify-center rounded border border-border text-base text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:w-auto sm:px-2 sm:py-1 sm:text-xs"
            :disabled="page <= 1"
            :aria-label="t('fileManager.preview.spreadsheetPreviousPage')"
            @click="previousPage"
          >
            ‹
          </button>
          <span class="text-text-secondary">
            {{ t('fileManager.preview.spreadsheetPage') }}
            <strong data-testid="spreadsheet-current-page" class="font-medium text-foreground">{{ page }}</strong>
            /
            <strong data-testid="spreadsheet-page-count" class="font-medium text-foreground">{{ pageCount }}</strong>
          </span>
          <button
            type="button"
            data-testid="spreadsheet-next-page"
            class="flex h-11 w-11 items-center justify-center rounded border border-border text-base text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:w-auto sm:px-2 sm:py-1 sm:text-xs"
            :disabled="page >= pageCount"
            :aria-label="t('fileManager.preview.spreadsheetNextPage')"
            @click="nextPage"
          >
            ›
          </button>
        </div>
      </div>

      <div
        data-testid="spreadsheet-sheet-tabs"
        role="tablist"
        :aria-label="t('fileManager.preview.worksheet')"
        class="spreadsheet-sheet-tabs flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-header px-2 py-1.5"
      >
        <button
          v-for="(sheet, index) in sheets"
          :key="`${sheet.name}-${index}`"
          type="button"
          role="tab"
          :data-testid="`spreadsheet-sheet-${index}`"
          class="min-h-11 max-w-48 shrink-0 truncate rounded border px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-primary sm:min-h-0"
          :class="
            index === sheetIndex
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-background text-text-secondary hover:bg-border hover:text-foreground'
          "
          :title="sheet.name"
          :aria-pressed="index === sheetIndex"
          :aria-selected="index === sheetIndex"
          @click="selectSheet(index)"
        >
          {{ sheet.name }}
        </button>
      </div>

      <PreviewHorizontalScrollbar
        :target="scroller"
        test-id="spreadsheet-horizontal-scrollbar"
        :active="active"
        :label="t('fileManager.preview.horizontalScroll')"
      />
    </div>
  </FilePreviewDialog>
</template>

<style scoped>
  .spreadsheet-preview td {
    min-width: 7rem;
  }

  .spreadsheet-preview .spreadsheet-header-row td {
    background: color-mix(in srgb, var(--color-header) 80%, transparent);
    font-weight: 600;
  }

  .spreadsheet-preview td.spreadsheet-search-match {
    background: color-mix(in srgb, var(--color-warning) 35%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-warning) 55%, transparent);
  }

  .spreadsheet-preview td.spreadsheet-search-active {
    background: color-mix(in srgb, var(--color-primary) 30%, transparent);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 80%, transparent);
  }

  .spreadsheet-scroll-container {
    scrollbar-gutter: stable;
    scrollbar-width: auto;
  }

  .spreadsheet-scroll-container::-webkit-scrollbar {
    width: 13px;
    height: 13px;
  }

  .spreadsheet-scroll-container::-webkit-scrollbar-track {
    background: color-mix(in srgb, var(--color-header) 75%, transparent);
  }

  .spreadsheet-scroll-container::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-color-secondary) 48%, transparent);
    background-clip: padding-box;
  }

  .spreadsheet-scroll-container::-webkit-scrollbar-thumb:hover {
    border: 3px solid transparent;
    background: color-mix(in srgb, var(--text-color-secondary) 70%, transparent);
    background-clip: padding-box;
  }

  .spreadsheet-sheet-tabs {
    scrollbar-width: thin;
  }
</style>
