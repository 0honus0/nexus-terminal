<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
  import { auditActionTypes, type AuditLogQuery } from '../model/audit';
  import { useAuditStore } from '../store/audit.store';

  const { t } = useI18n();
  const store = useAuditStore();
  const { logs, total, loading, error } = storeToRefs(store);
  const searchDraft = ref('');
  const actionTypeDraft = ref('');
  const appliedFilters = ref<Pick<AuditLogQuery, 'search' | 'actionType'>>({});
  const page = ref(1);
  const limit = 50;
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));
  const paginationRange = computed<Array<number | string>>(() => {
    const last = totalPages.value;
    if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);
    const values = new Set<number>([1, last]);
    for (let value = Math.max(2, page.value - 2); value <= Math.min(last - 1, page.value + 2); value += 1)
      values.add(value);
    const sorted = [...values].sort((a, b) => a - b);
    const result: Array<number | string> = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const value = sorted[index]!;
      const previous = sorted[index - 1];
      if (previous !== undefined && value - previous > 1) result.push(`ellipsis-${previous}`);
      result.push(value);
    }
    return result;
  });

  const load = () =>
    store.load({
      ...appliedFilters.value,
      limit,
      offset: (page.value - 1) * limit,
    });
  const applyFilters = () => {
    appliedFilters.value = {
      ...(searchDraft.value.trim() ? { search: searchDraft.value.trim() } : {}),
      ...(actionTypeDraft.value ? { actionType: actionTypeDraft.value } : {}),
    };
    if (page.value === 1) void load();
    else page.value = 1;
  };
  const changePage = (next: number) => {
    if (next >= 1 && next <= totalPages.value && next !== page.value) page.value = next;
  };
  const details = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('raw' in record && record.parseError) return t('auditLog.parseErrorRaw', { raw: String(record.raw ?? '') });
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  onMounted(() => void load());
  watch(page, () => void load());
</script>

<template>
  <div data-testid="audit-log-view" class="bg-background p-4 text-foreground">
    <div class="mx-auto max-w-7xl">
      <h1 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">{{ t('auditLog.title') }}</h1>

      <div class="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-header/50 p-4">
        <div class="min-w-[200px] flex-grow">
          <label for="search-term" class="mb-1 block text-sm font-medium text-text-secondary">{{
            t('common.search')
          }}</label>
          <input
            id="search-term"
            v-model="searchDraft"
            data-testid="audit-search"
            type="text"
            :placeholder="t('auditLog.searchPlaceholder')"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            @keyup.enter="applyFilters"
          />
        </div>
        <div class="min-w-[200px] flex-grow">
          <label for="action-type" class="mb-1 block text-sm font-medium text-text-secondary">{{
            t('auditLog.table.actionType')
          }}</label>
          <select
            id="action-type"
            v-model="actionTypeDraft"
            data-testid="audit-action-type"
            class="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">{{ t('common.all') }}</option>
            <option v-for="type in auditActionTypes" :key="type" :value="type">
              {{ t(`auditLog.actions.${type}`, type) }}
            </option>
          </select>
        </div>
        <div class="self-end">
          <button
            data-testid="audit-apply-filter"
            type="button"
            class="rounded bg-button px-4 py-2 text-sm font-medium text-button-text hover:bg-button-hover"
            @click="applyFilters"
          >
            {{ t('common.filter') }}
          </button>
        </div>
      </div>

      <div v-if="error" class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error">
        {{ error === 'audit-load-error' ? t('auditLog.loadFailed') : error }}
      </div>
      <div v-else-if="loading && logs.length === 0" class="p-4 text-center text-text-secondary italic">
        <BaseSpinner class="mx-auto" />
      </div>
      <div
        v-else-if="!loading && logs.length === 0"
        class="mb-4 rounded border-l-4 border-blue-400 bg-blue-100 p-4 text-blue-700"
      >
        {{ t('auditLog.noLogs') }}
      </div>

      <div v-else>
        <nav v-if="totalPages > 1" :aria-label="t('auditLog.title')" class="mb-4 flex justify-center">
          <ul class="inline-flex items-center -space-x-px">
            <li>
              <button
                type="button"
                :disabled="page === 1"
                class="ml-0 rounded-l-lg border border-border bg-background px-3 py-2 leading-tight text-text-secondary hover:bg-header hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                @click="changePage(page - 1)"
              >
                «
              </button>
            </li>
            <li v-for="item in paginationRange" :key="String(item)">
              <span
                v-if="typeof item === 'string'"
                class="border border-border bg-background px-3 py-2 leading-tight text-text-secondary"
                >…</span
              >
              <button
                v-else
                type="button"
                class="border border-border px-3 py-2 leading-tight"
                :class="
                  item === page
                    ? 'border-button bg-button text-button-text hover:bg-button-hover'
                    : 'bg-background text-text-secondary hover:bg-header hover:text-foreground'
                "
                @click="changePage(item)"
              >
                {{ item }}
              </button>
            </li>
            <li>
              <button
                type="button"
                :disabled="page === totalPages"
                class="rounded-r-lg border border-border bg-background px-3 py-2 leading-tight text-text-secondary hover:bg-header hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                @click="changePage(page + 1)"
              >
                »
              </button>
            </li>
          </ul>
        </nav>
        <div class="mb-4 text-right text-sm text-text-secondary">
          {{ t('auditLog.paginationInfo', { currentPage: page, totalPages, totalLogs: total }) }}
        </div>
        <div class="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-border text-sm">
              <thead class="bg-header">
                <tr>
                  <th class="whitespace-nowrap px-6 py-3 text-left font-medium tracking-wider text-text-secondary">
                    {{ t('auditLog.table.timestamp') }}
                  </th>
                  <th class="whitespace-nowrap px-6 py-3 text-left font-medium tracking-wider text-text-secondary">
                    {{ t('auditLog.table.actionType') }}
                  </th>
                  <th class="px-6 py-3 text-left font-medium tracking-wider text-text-secondary">
                    {{ t('auditLog.table.details') }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <tr v-for="log in logs" :key="log.id" :data-audit-id="log.id" class="hover:bg-header/50">
                  <td class="whitespace-nowrap px-6 py-4">{{ new Date(log.timestamp * 1000).toLocaleString() }}</td>
                  <td class="whitespace-nowrap px-6 py-4">
                    {{ t(`auditLog.actions.${log.actionType}`, log.actionType) }}
                  </td>
                  <td class="px-6 py-4">
                    <pre
                      v-if="log.details"
                      class="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded border border-border/50 bg-header/50 p-2 font-mono text-xs"
                      >{{ details(log.details) }}</pre>
                    <span v-else class="text-text-secondary">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
