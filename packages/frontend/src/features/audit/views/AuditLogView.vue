<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput, BaseSelect, BaseSpinner, BaseTable } from '@/foundation/ui';
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
  <main data-testid="audit-log-view" class="mx-auto w-full max-w-7xl p-6">
    <h1 class="mb-5 text-2xl font-semibold">{{ t('auditLog.title') }}</h1>
    <div class="mb-4 grid gap-3 md:grid-cols-[1fr_280px_auto]">
      <BaseInput
        v-model="searchDraft"
        data-testid="audit-search"
        :placeholder="t('auditLog.searchPlaceholder')"
        @keyup.enter="applyFilters"
      />
      <BaseSelect v-model="actionTypeDraft" data-testid="audit-action-type">
        <option value="">{{ t('auditLog.allActions') }}</option>
        <option v-for="type in auditActionTypes" :key="type" :value="type">
          {{ t(`auditLog.actions.${type}`, type) }}
        </option>
      </BaseSelect>
      <BaseButton data-testid="audit-apply-filter" variant="primary" @click="applyFilters">{{
        t('common.filter')
      }}</BaseButton>
    </div>

    <BaseSpinner v-if="loading && !logs.length" />
    <p v-else-if="error" class="text-error">{{ error === 'audit-load-error' ? t('auditLog.loadFailed') : error }}</p>
    <BaseTable v-else>
      <thead>
        <tr>
          <th>{{ t('auditLog.table.timestamp') }}</th>
          <th>{{ t('auditLog.table.actionType') }}</th>
          <th>{{ t('auditLog.table.details') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in logs" :key="log.id" :data-audit-id="log.id">
          <td>{{ new Date(log.timestamp * 1000).toLocaleString() }}</td>
          <td>{{ t(`auditLog.actions.${log.actionType}`, log.actionType) }}</td>
          <td>
            <pre class="max-w-3xl whitespace-pre-wrap text-xs">{{ details(log.details) }}</pre>
          </td>
        </tr>
        <tr v-if="!logs.length">
          <td colspan="3">{{ t('auditLog.noLogs') }}</td>
        </tr>
      </tbody>
    </BaseTable>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-text-secondary">{{
        t('auditLog.paginationInfo', { currentPage: page, totalPages, totalLogs: total })
      }}</span>
      <div class="flex flex-wrap items-center gap-1">
        <BaseButton size="sm" :disabled="page <= 1" @click="changePage(page - 1)">←</BaseButton>
        <template v-for="item in paginationRange" :key="String(item)">
          <span v-if="typeof item === 'string'" class="px-2 text-text-secondary">…</span>
          <BaseButton
            v-else
            size="sm"
            :variant="item === page ? 'primary' : 'ghost'"
            :aria-current="item === page ? 'page' : undefined"
            @click="changePage(item)"
            >{{ item }}</BaseButton
          >
        </template>
        <BaseButton size="sm" :disabled="page >= totalPages" @click="changePage(page + 1)">→</BaseButton>
      </div>
    </div>
  </main>
</template>
