<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseModal } from '@/foundation/ui';
  import type { ProgressSource, TransferTask } from '../model/transfer';

  const props = defineProps<{ visible: boolean; sources: readonly ProgressSource[] }>();
  const emit = defineEmits<{
    close: [];
    restore: [sourceId: string];
    cancel: [sourceId: string, taskId: string];
    cancelAll: [sourceId: string];
    remove: [sourceId: string, taskId: string];
  }>();
  const { t } = useI18n();

  const done = (status: TransferTask['status']) =>
    ['completed', 'cancelled', 'skipped', 'partial', 'error'].includes(status);
  const activeCount = (source: ProgressSource) => source.tasks.filter((task) => !done(task.status)).length;
  const totalTasks = computed(() => props.sources.reduce((sum, source) => sum + source.tasks.length, 0));
  const normalizedProgress = (task: TransferTask) => Math.max(0, Math.min(100, task.progress));
</script>

<template>
  <BaseModal
    data-testid="progress-display-overlay"
    panel-test-id="progress-display-dialog"
    :visible="visible"
    :title="`${t('progressCenter.hiddenTitle')} (${totalTasks})`"
    panel-class="w-[min(94vw,860px)] max-h-[86vh]"
    @close="emit('close')"
  >
    <div data-testid="progress-display-modal" class="min-h-0">
      <div
        v-if="!sources.length"
        data-testid="progress-display-empty"
        class="py-10 text-center text-sm text-text-secondary"
      >
        {{ t('progressCenter.empty') }}
      </div>
      <div v-else data-testid="hidden-progress-list" class="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <section
          v-for="source in sources"
          :key="source.id"
          data-testid="hidden-progress-source"
          class="rounded-lg border border-border bg-background"
        >
          <header
            class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-header/50 px-3 py-2"
          >
            <div class="min-w-0">
              <h3 class="truncate font-semibold">{{ source.label }}</h3>
              <p class="text-xs text-text-secondary">
                {{ t('progressCenter.sourceSummary', { count: source.tasks.length, active: activeCount(source) }) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-1">
              <BaseButton
                v-if="source.restorable !== false"
                data-testid="hidden-progress-restore"
                size="sm"
                variant="ghost"
                @click="emit('restore', source.id)"
                >{{ t('progressCenter.restore') }}</BaseButton
              >
              <BaseButton
                v-if="activeCount(source)"
                data-testid="hidden-progress-cancel-all"
                size="sm"
                variant="danger"
                @click="emit('cancelAll', source.id)"
                >{{ t('progressCenter.cancelAll') }}</BaseButton
              >
            </div>
          </header>

          <ul data-testid="hidden-progress-source-list" class="max-h-64 divide-y divide-border overflow-y-auto">
            <li v-for="task in source.tasks" :key="task.id" data-testid="hidden-progress-task" class="space-y-2 p-3">
              <div class="flex min-w-0 items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ task.label }}</span>
                <span class="shrink-0 text-xs text-text-secondary">{{ t(`progressCenter.kind.${task.kind}`) }}</span>
              </div>
              <div
                role="progressbar"
                :aria-valuemin="0"
                :aria-valuemax="100"
                :aria-valuenow="Math.round(normalizedProgress(task))"
                class="h-1.5 overflow-hidden rounded bg-header"
              >
                <div
                  data-testid="hidden-progress-bar"
                  class="h-full bg-primary"
                  :style="{ width: `${normalizedProgress(task)}%` }"
                ></div>
              </div>
              <div class="flex items-center justify-between gap-2 text-xs text-text-secondary">
                <span data-testid="hidden-progress-percent"
                  >{{ t(`progressCenter.status.${task.status}`) }} · {{ Math.round(normalizedProgress(task)) }}%</span
                >
                <div class="flex gap-1">
                  <BaseButton
                    v-if="!done(task.status)"
                    data-testid="hidden-progress-cancel"
                    size="sm"
                    @click="emit('cancel', source.id, task.id)"
                    >{{ t('common.cancel') }}</BaseButton
                  >
                  <BaseButton v-else size="sm" variant="ghost" @click="emit('remove', source.id, task.id)"
                    >×</BaseButton
                  >
                </div>
              </div>
              <p v-if="task.warning" class="text-xs text-warning">{{ task.warning }}</p>
              <p v-if="task.error" class="text-xs text-error">{{ task.error }}</p>
            </li>
          </ul>
        </section>
      </div>
      <div class="mt-4 flex justify-end">
        <BaseButton data-testid="progress-display-close" @click="emit('close')">{{ t('common.close') }}</BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
