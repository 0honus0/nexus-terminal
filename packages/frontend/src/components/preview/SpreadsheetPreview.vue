<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';

interface SpreadsheetPage {
  rows: unknown[][];
  displayedRows: number;
  startRow: number;
  rowHeights: Array<number | null>;
}

interface SpreadsheetSheet {
  name: string;
  totalRows: number;
  totalColumns: number;
  displayedColumns: number;
  columnWidths: Array<number | null>;
  getPage(pageIndex: number, rowsPerPage: number): SpreadsheetPage;
}

const props = defineProps<{
  file: FileListItem;
  sheets: SpreadsheetSheet[];
  rowsPerPage: number;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const activeIndex = ref(0);
const currentPage = ref(1);
const previewRootRef = ref<HTMLElement | null>(null);
const scrollContainerRef = ref<HTMLElement | null>(null);
const activeSheet = computed(() => props.sheets[activeIndex.value] ?? props.sheets[0]);
const pageCount = computed(() => activeSheet.value
  ? Math.max(1, Math.ceil(activeSheet.value.totalRows / props.rowsPerPage))
  : 1);
const activePage = computed(() => activeSheet.value?.getPage(currentPage.value - 1, props.rowsPerPage));
const columnsTruncated = computed(() => Boolean(activeSheet.value && (
  activeSheet.value.displayedColumns < activeSheet.value.totalColumns
)));
const pageRangeStart = computed(() => activePage.value && activePage.value.displayedRows > 0
  ? activePage.value.startRow + 1
  : 0);
const pageRangeEnd = computed(() => activePage.value
  ? activePage.value.startRow + activePage.value.displayedRows
  : 0);
const placeholderRowCount = computed(() => activePage.value
  ? Math.max(0, props.rowsPerPage - activePage.value.displayedRows)
  : 0);
const subtitle = computed(() => activeSheet.value
  ? t('fileManager.preview.spreadsheetMeta', {
      sheet: activeSheet.value.name,
      rows: activeSheet.value.totalRows,
      columns: activeSheet.value.totalColumns,
    })
  : t('fileManager.preview.spreadsheet', 'Spreadsheet'));

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
};

const focusPreview = () => {
  void nextTick(() => previewRootRef.value?.focus({ preventScroll: true }));
};

const resetScroll = () => {
  const scrollContainer = scrollContainerRef.value;
  if (scrollContainer) scrollContainer.scrollTo({ left: 0, top: 0, behavior: 'auto' });
};

const selectPage = (page: number) => {
  currentPage.value = Math.min(pageCount.value, Math.max(1, Math.round(page)));
  resetScroll();
  focusPreview();
};

const previousPage = () => selectPage(currentPage.value - 1);
const nextPage = () => selectPage(currentPage.value + 1);

const handleGridKeydown = (event: KeyboardEvent) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
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

  const scrollContainer = scrollContainerRef.value;
  if (!scrollContainer) return;

  const verticalStep = Math.max(48, Math.round(scrollContainer.clientHeight * 0.18));
  const horizontalStep = Math.max(96, Math.round(scrollContainer.clientWidth * 0.18));
  let left = 0;
  let top = 0;

  switch (event.key) {
    case 'ArrowUp': top = -verticalStep; break;
    case 'ArrowDown': top = verticalStep; break;
    case 'ArrowLeft': left = -horizontalStep; break;
    case 'ArrowRight': left = horizontalStep; break;
    default: return;
  }

  event.preventDefault();
  scrollContainer.scrollBy({ left, top, behavior: 'auto' });
};

const selectSheet = (index: number) => {
  activeIndex.value = index;
};

watch(activeIndex, () => {
  currentPage.value = 1;
  resetScroll();
  focusPreview();
});

watch(pageCount, (count) => {
  if (currentPage.value > count) currentPage.value = count;
});

onMounted(() => window.setTimeout(focusPreview, 0));
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="subtitle"
    @close="emit('close')"
  >
    <div
      v-if="activeSheet && activePage"
      ref="previewRootRef"
      data-testid="spreadsheet-preview"
      class="flex h-full min-h-0 w-full flex-col overflow-hidden outline-none"
      tabindex="-1"
      @keydown="handleGridKeydown"
    >
      <div
        ref="scrollContainerRef"
        data-testid="spreadsheet-scroll-container"
        class="spreadsheet-scroll-container min-h-0 flex-1 overflow-scroll"
      >
        <table class="spreadsheet-preview min-w-full border-separate border-spacing-0 text-xs">
          <tbody>
            <tr
              v-for="(row, rowIndex) in activePage.rows"
              :key="activePage.startRow + rowIndex"
              :style="activePage.rowHeights[rowIndex] ? { height: `${activePage.rowHeights[rowIndex]}px` } : undefined"
            >
              <th class="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-1.5 text-right font-normal text-text-secondary">
                {{ activePage.startRow + rowIndex + 1 }}
              </th>
              <td
                v-for="(cell, columnIndex) in row"
                :key="columnIndex"
                class="max-w-80 whitespace-pre-wrap border-b border-r border-border px-2 py-1.5 align-top"
                :style="activeSheet.columnWidths[columnIndex]
                  ? { width: `${activeSheet.columnWidths[columnIndex]}px`, minWidth: `${activeSheet.columnWidths[columnIndex]}px` }
                  : undefined"
                :title="formatCell(cell)"
              >
                {{ formatCell(cell) }}
              </td>
            </tr>
            <tr
              v-for="placeholderIndex in placeholderRowCount"
              :key="`placeholder-${currentPage}-${placeholderIndex}`"
              data-testid="spreadsheet-placeholder-row"
              aria-hidden="true"
              class="h-7 select-none pointer-events-none"
            >
              <th class="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-1.5" />
              <td
                v-for="columnIndex in activeSheet.displayedColumns"
                :key="columnIndex"
                class="border-b border-r border-border px-2 py-1.5"
                :style="activeSheet.columnWidths[columnIndex - 1]
                  ? { width: `${activeSheet.columnWidths[columnIndex - 1]}px`, minWidth: `${activeSheet.columnWidths[columnIndex - 1]}px` }
                  : undefined"
              >
                &nbsp;
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
          {{ t('fileManager.preview.spreadsheetLimited', {
            displayedColumns: activeSheet.displayedColumns,
            totalColumns: activeSheet.totalColumns,
            totalRows: activeSheet.totalRows,
          }) }}
        </div>
      </div>

      <div
        data-testid="spreadsheet-pagination"
        class="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-header px-3 py-1.5 text-xs"
      >
        <span
          data-testid="spreadsheet-page-range"
          class="min-w-0 truncate text-text-secondary"
        >
          {{ t('fileManager.preview.spreadsheetPageRange', {
            start: pageRangeStart,
            end: pageRangeEnd,
            total: activeSheet.totalRows,
          }) }}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="spreadsheet-previous-page"
            class="rounded border border-border px-2 py-1 text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="currentPage <= 1"
            :aria-label="t('fileManager.preview.spreadsheetPreviousPage', 'Previous page')"
            @click="previousPage"
          >
            ‹
          </button>
          <span class="text-text-secondary">
            {{ t('fileManager.preview.spreadsheetPage', 'Page') }}
            <strong data-testid="spreadsheet-current-page" class="font-medium text-foreground">{{ currentPage }}</strong>
            /
            <strong data-testid="spreadsheet-page-count" class="font-medium text-foreground">{{ pageCount }}</strong>
          </span>
          <button
            type="button"
            data-testid="spreadsheet-next-page"
            class="rounded border border-border px-2 py-1 text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="currentPage >= pageCount"
            :aria-label="t('fileManager.preview.spreadsheetNextPage', 'Next page')"
            @click="nextPage"
          >
            ›
          </button>
        </div>
      </div>

      <div
        data-testid="spreadsheet-sheet-tabs"
        class="spreadsheet-sheet-tabs flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-header px-2 py-1.5"
        :aria-label="t('fileManager.preview.worksheet', 'Worksheet')"
      >
        <button
          v-for="(sheet, index) in props.sheets"
          :key="`${sheet.name}-${index}`"
          type="button"
          :data-testid="`spreadsheet-sheet-${index}`"
          class="max-w-48 shrink-0 truncate rounded border px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
          :class="index === activeIndex
            ? 'border-primary bg-primary/15 text-primary'
            : 'border-border bg-background text-text-secondary hover:bg-border hover:text-foreground'"
          :title="sheet.name"
          :aria-pressed="index === activeIndex"
          @click="selectSheet(index)"
        >
          {{ sheet.name }}
        </button>
      </div>
    </div>
  </FilePreviewDialog>
</template>

<style scoped>
.spreadsheet-preview td {
  min-width: 7rem;
}

.spreadsheet-preview tr:first-child td {
  background: color-mix(in srgb, var(--color-header) 80%, transparent);
  font-weight: 600;
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
  background: color-mix(in srgb, var(--text-color-secondary) 48%, transparent);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.spreadsheet-scroll-container::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-color-secondary) 70%, transparent);
  border: 3px solid transparent;
  background-clip: padding-box;
}

.spreadsheet-sheet-tabs {
  scrollbar-width: thin;
}
</style>
