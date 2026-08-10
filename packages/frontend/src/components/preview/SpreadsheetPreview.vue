<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';

interface SpreadsheetSheet {
  name: string;
  rows: unknown[][];
  totalRows: number;
  totalColumns: number;
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
const activeSheet = computed(() => props.sheets[activeIndex.value] ?? props.sheets[0]);
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
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="subtitle"
    @close="emit('close')"
  >
    <template #toolbar>
      <select
        v-if="props.sheets.length > 1"
        v-model.number="activeIndex"
        class="max-w-52 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        :aria-label="t('fileManager.preview.worksheet', 'Worksheet')"
      >
        <option v-for="(sheet, index) in props.sheets" :key="`${sheet.name}-${index}`" :value="index">
          {{ sheet.name }}
        </option>
      </select>
    </template>

    <div v-if="activeSheet" class="min-w-full overflow-auto">
      <table class="spreadsheet-preview min-w-full border-separate border-spacing-0 text-xs">
        <tbody>
          <tr v-for="(row, rowIndex) in activeSheet.rows" :key="rowIndex">
            <th class="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-header px-2 py-1.5 text-right font-normal text-text-secondary">
              {{ rowIndex + 1 }}
            </th>
            <td
              v-for="(cell, columnIndex) in row"
              :key="columnIndex"
              class="max-w-80 whitespace-pre-wrap border-b border-r border-border px-2 py-1.5 align-top"
              :title="formatCell(cell)"
            >
              {{ formatCell(cell) }}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        v-if="activeSheet.rows.length < activeSheet.totalRows || (activeSheet.rows[0]?.length ?? 0) < activeSheet.totalColumns"
        class="sticky bottom-0 border-t border-border bg-header/95 px-4 py-2 text-xs text-text-secondary backdrop-blur"
      >
        {{ t('fileManager.preview.spreadsheetLimited', {
          rows: activeSheet.rows.length,
          columns: activeSheet.rows[0]?.length ?? 0,
        }) }}
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
</style>
