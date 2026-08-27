<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';

interface SpreadsheetSheet {
  name: string;
  rows: unknown[][];
  totalRows: number;
  totalColumns: number;
  displayedRows: number;
  displayedColumns: number;
  startRow: number;
  columnWidths: Array<number | null>;
  rowHeights: Array<number | null>;
}

const props = defineProps<{
  file: FileListItem;
  sheets: SpreadsheetSheet[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const activeIndex = ref(0);
const previewRootRef = ref<HTMLElement | null>(null);
const scrollContainerRef = ref<HTMLElement | null>(null);
const activeSheet = computed(() => props.sheets[activeIndex.value] ?? props.sheets[0]);
const isTruncated = computed(() => Boolean(activeSheet.value && (
  activeSheet.value.displayedRows < activeSheet.value.totalRows ||
  activeSheet.value.displayedColumns < activeSheet.value.totalColumns
)));
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

const handleGridKeydown = (event: KeyboardEvent) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
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
  const scrollContainer = scrollContainerRef.value;
  if (scrollContainer) scrollContainer.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  focusPreview();
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
      v-if="activeSheet"
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
              v-for="(row, rowIndex) in activeSheet.rows"
              :key="rowIndex"
              :style="activeSheet.rowHeights[rowIndex] ? { height: `${activeSheet.rowHeights[rowIndex]}px` } : undefined"
            >
              <th class="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-1.5 text-right font-normal text-text-secondary">
                {{ activeSheet.startRow + rowIndex + 1 }}
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
          </tbody>
        </table>

        <div
          v-if="isTruncated"
          data-testid="spreadsheet-preview-limit-notice"
          role="status"
          class="sticky bottom-0 border-t border-border bg-header/95 px-4 py-2 text-xs text-text-secondary backdrop-blur"
        >
          {{ t('fileManager.preview.spreadsheetLimited', {
            displayedRows: activeSheet.displayedRows,
            totalRows: activeSheet.totalRows,
            displayedColumns: activeSheet.displayedColumns,
            totalColumns: activeSheet.totalColumns,
          }) }}
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
