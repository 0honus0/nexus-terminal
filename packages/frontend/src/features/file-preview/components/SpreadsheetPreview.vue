<script setup lang="ts">
  import { computed, nextTick, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton } from '@/foundation/ui';
  import { parseSpreadsheetPreview, type SpreadsheetSearchMatch } from '../model/spreadsheetPreview';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';

  const props = withDefaults(
    defineProps<{ bytes: ArrayBuffer; rowsPerPage?: number; maxColumns?: number; active?: boolean }>(),
    { rowsPerPage: 500, maxColumns: 100, active: true },
  );
  const { t } = useI18n();
  const root = ref<HTMLElement | null>(null);
  const scroller = ref<HTMLElement | null>(null);
  const sheetIndex = ref(0);
  const page = ref(1);
  const searchOpen = ref(false);
  const search = ref('');
  const searchIndex = ref(-1);

  const rowsPerPage = computed(() => Math.min(2000, Math.max(10, Number(props.rowsPerPage) || 500)));
  const maxColumns = computed(() => Math.min(200, Math.max(5, Number(props.maxColumns) || 100)));
  const sheets = computed(() => parseSpreadsheetPreview(props.bytes, maxColumns.value));
  const activeSheet = computed(() => sheets.value[sheetIndex.value] ?? sheets.value[0] ?? null);
  const pageCount = computed(() =>
    activeSheet.value ? Math.max(1, Math.ceil(activeSheet.value.totalRows / rowsPerPage.value)) : 1,
  );
  const pageStart = computed(() => (page.value - 1) * rowsPerPage.value);
  const pageRows = computed(() => activeSheet.value?.page(pageStart.value, rowsPerPage.value) ?? []);
  const pageEnd = computed(() => Math.min(activeSheet.value?.totalRows ?? 0, pageStart.value + pageRows.value.length));
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
    searchMatches.value.forEach((match) => {
      if (match.sheetIndex === sheetIndex.value) keys.add(`${match.rowIndex}:${match.colIndex}`);
    });
    return keys;
  });
  const isSearchMatch = (rowIndex: number, colIndex: number): boolean =>
    currentSheetMatchKeys.value.has(`${pageStart.value + rowIndex}:${colIndex}`);
  const isActiveMatch = (rowIndex: number, colIndex: number): boolean =>
    activeMatch.value?.sheetIndex === sheetIndex.value &&
    activeMatch.value.rowIndex === pageStart.value + rowIndex &&
    activeMatch.value.colIndex === colIndex;

  const resetScroll = (): void => {
    if (!scroller.value) return;
    scroller.value.scrollLeft = 0;
    scroller.value.scrollTop = 0;
  };
  const selectSheet = async (index: number): Promise<void> => {
    sheetIndex.value = Math.min(Math.max(index, 0), Math.max(0, sheets.value.length - 1));
    page.value = 1;
    await nextTick();
    resetScroll();
  };
  const goPage = async (next: number): Promise<void> => {
    page.value = Math.min(pageCount.value, Math.max(1, next));
    await nextTick();
    resetScroll();
  };
  const revealMatch = async (): Promise<void> => {
    const match = activeMatch.value;
    if (!match) return;
    sheetIndex.value = match.sheetIndex;
    page.value = Math.floor(match.rowIndex / rowsPerPage.value) + 1;
    await nextTick();
    root.value
      ?.querySelector<HTMLElement>('[data-search-active="true"]')
      ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };
  const moveSearch = async (delta: number): Promise<void> => {
    const matches = searchMatches.value;
    if (!matches.length) {
      searchIndex.value = -1;
      return;
    }
    searchIndex.value = (searchIndex.value + delta + matches.length) % matches.length;
    await revealMatch();
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,button,select,textarea')) return;
    if (event.key === 'PageUp') {
      event.preventDefault();
      void goPage(page.value - 1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      void goPage(page.value + 1);
    } else if (event.key === 'ArrowRight') {
      scroller.value?.scrollBy({ left: 100 });
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      scroller.value?.scrollBy({ left: -100 });
      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      scroller.value?.scrollBy({ top: 80 });
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      scroller.value?.scrollBy({ top: -80 });
      event.preventDefault();
    }
  };
  const closeSearch = (): void => {
    searchOpen.value = false;
    search.value = '';
    searchIndex.value = -1;
  };
  const columnStyle = (column: number): Record<string, string> => {
    const width = activeSheet.value?.columnWidths[column];
    if (!width) return {};
    return { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };
  };
  const rowStyle = (row: number): Record<string, string> => {
    const height = activeSheet.value?.rowHeights[pageStart.value + row];
    return height ? { height: `${height}px` } : {};
  };

  watch(searchMatches, (matches) => {
    searchIndex.value = matches.length ? 0 : -1;
    void revealMatch();
  });
  watch(
    () => [props.bytes, props.rowsPerPage, props.maxColumns] as const,
    () => {
      sheetIndex.value = Math.min(sheetIndex.value, Math.max(0, sheets.value.length - 1));
      page.value = 1;
      searchIndex.value = searchMatches.value.length ? 0 : -1;
    },
  );
  watch(pageCount, (count) => {
    if (page.value > count) page.value = count;
  });
</script>

<template>
  <div ref="root" class="flex h-full min-h-0 flex-col outline-none" tabindex="0" @keydown="handleKeydown">
    <div class="flex flex-wrap items-center gap-1 border-b border-border p-2">
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
      <span v-if="activeSheet" class="ml-auto text-xs text-text-secondary">{{
        t('fileManager.preview.spreadsheetMeta', {
          sheet: activeSheet.name,
          rows: activeSheet.totalRows,
          columns: activeSheet.totalColumns,
        })
      }}</span>
    </div>

    <div
      ref="scroller"
      role="region"
      :aria-label="t('fileManager.preview.spreadsheet')"
      class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
    >
      <table v-if="activeSheet" class="spreadsheet-preview min-w-max border-collapse text-xs">
        <tbody>
          <tr v-for="(row, rowIndex) in pageRows" :key="pageStart + rowIndex" :style="rowStyle(rowIndex)">
            <th
              scope="row"
              class="sticky left-0 z-10 w-14 min-w-14 border border-border bg-header px-2 py-1 text-right font-normal text-text-secondary"
            >
              {{ activeSheet.startRow + pageStart + rowIndex + 1 }}
            </th>
            <td
              v-for="(cell, colIndex) in row"
              :key="colIndex"
              class="max-w-80 whitespace-pre-wrap border border-border px-2 py-1 align-top"
              :class="[
                page === 1 && rowIndex === 0 ? 'bg-header font-semibold' : '',
                isSearchMatch(rowIndex, colIndex) ? 'bg-warning/20' : '',
                isActiveMatch(rowIndex, colIndex) ? 'outline outline-2 outline-warning' : '',
              ]"
              :style="columnStyle(colIndex)"
              :data-search-active="isActiveMatch(rowIndex, colIndex) ? 'true' : undefined"
              :title="cell"
            >
              {{ cell }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PreviewHorizontalScrollbar
      :target="scroller"
      :active="active"
      :label="t('fileManager.preview.horizontalScroll')"
    />

    <div class="flex flex-col gap-1 border-t border-border bg-background p-2">
      <div
        role="tablist"
        :aria-label="t('fileManager.preview.worksheet')"
        class="flex max-w-full gap-1 overflow-x-auto pb-1"
      >
        <BaseButton
          v-for="(candidate, index) in sheets"
          :key="candidate.name"
          role="tab"
          class="min-h-11 sm:min-h-0"
          size="sm"
          :variant="sheetIndex === index ? 'primary' : 'ghost'"
          :aria-selected="sheetIndex === index"
          @click="selectSheet(index)"
          >{{ candidate.name }}</BaseButton
        >
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>{{
          t('fileManager.preview.spreadsheetPageRange', {
            start: activeSheet?.totalRows ? activeSheet.startRow + pageStart + 1 : 0,
            end: activeSheet ? activeSheet.startRow + pageEnd : 0,
            total: activeSheet?.totalRows ?? 0,
          })
        }}</span>
        <span v-if="activeSheet && activeSheet.totalColumns > activeSheet.displayedColumns">{{
          t('fileManager.preview.spreadsheetLimited', {
            displayedColumns: activeSheet.displayedColumns,
            totalColumns: activeSheet.totalColumns,
            totalRows: activeSheet.totalRows,
          })
        }}</span>
        <div class="ml-auto flex items-center gap-1">
          <BaseButton
            class="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
            size="sm"
            :aria-label="t('fileManager.preview.spreadsheetPreviousPage')"
            :disabled="page <= 1"
            @click="goPage(page - 1)"
            >←</BaseButton
          >
          <span>{{ page }}/{{ pageCount }}</span>
          <BaseButton
            class="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
            size="sm"
            :aria-label="t('fileManager.preview.spreadsheetNextPage')"
            :disabled="page >= pageCount"
            @click="goPage(page + 1)"
            >→</BaseButton
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .spreadsheet-preview td {
    min-width: 7rem;
  }
</style>
