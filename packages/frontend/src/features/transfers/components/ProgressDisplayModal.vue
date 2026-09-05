<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import type { ProgressSource, TransferTask } from '../model/transfer';

  const props = withDefaults(
    defineProps<{ visible: boolean; sources: readonly ProgressSource[]; mobile?: boolean }>(),
    {
      mobile: false,
    },
  );
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
  const normalizedProgress = (task: TransferTask) => Math.max(0, Math.min(100, task.progress));
</script>

<template>
  <OverlayPanel
    :visible="visible"
    :overlay="mobile"
    :teleport="mobile"
    :z-index="1100"
    preset="standard-modal"
    panel-test-id="progress-display-dialog"
    data-testid="progress-display-overlay"
    @close="emit('close')"
  >
    <section
      v-if="visible"
      data-testid="progress-display-modal"
      :data-progress-display-placement="mobile ? 'overlay' : 'inline'"
      :class="[
        'text-foreground',
        mobile
          ? 'progress-display-mobile flex min-h-0 flex-col overflow-hidden bg-background'
          : 'progress-display-inline flex-shrink-0 border-x border-b border-border bg-background',
      ]"
    >
      <div
        class="transfer-progress-panel mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden bg-background"
      >
        <div class="transfer-progress-header relative flex-shrink-0 px-4 py-3 sm:px-6">
          <h3 class="m-0 text-center text-lg font-semibold">{{ t('progressCenter.title') }}</h3>
          <button
            type="button"
            data-testid="transfer-progress-minimize"
            class="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-text-secondary hover:bg-border/60 hover:text-foreground"
            :title="t('progressCenter.hide')"
            :aria-label="t('progressCenter.hide')"
            @click.stop="emit('close')"
          >
            <i class="fas fa-minus" aria-hidden="true"></i>
          </button>
        </div>

        <div
          class="progress-display-content custom-scrollbar min-h-0 flex-grow space-y-4 overflow-y-auto px-4 pr-4 sm:px-6 sm:pr-8"
        >
          <section data-testid="progress-display-hidden-section" class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h4 class="m-0 text-sm font-semibold">{{ t('progressCenter.hiddenTitle') }}</h4>
              </div>
              <span class="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-xs tabular-nums text-text-secondary">
                {{ sources.length }}
              </span>
            </div>

            <div
              v-if="!sources.length"
              data-testid="progress-display-empty"
              class="rounded border border-dashed border-border px-3 py-5 text-center text-xs text-text-secondary"
            >
              {{ t('progressCenter.empty') }}
            </div>

            <div v-else data-testid="hidden-progress-list" class="hidden-progress-source-grid">
              <article
                v-for="source in sources"
                :key="source.id"
                data-testid="hidden-progress-source"
                class="hidden-progress-source-card"
              >
                <div class="hidden-progress-source-header">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <strong class="min-w-0 flex-1 truncate text-sm" :title="source.label">{{ source.label }}</strong>
                      <span
                        class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary"
                      >
                        {{ source.tasks.length }}
                      </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      v-if="source.restorable !== false"
                      type="button"
                      data-testid="hidden-progress-restore"
                      class="rounded border border-border px-2 py-1 text-[11px] hover:border-primary hover:text-primary"
                      @click="emit('restore', source.id)"
                    >
                      <i class="fas fa-window-restore mr-1" aria-hidden="true"></i>{{ t('progressCenter.restore') }}
                    </button>
                    <button
                      v-if="activeCount(source) > 0"
                      type="button"
                      data-testid="hidden-progress-cancel-all"
                      class="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300"
                      @click="emit('cancelAll', source.id)"
                    >
                      {{ t('progressCenter.cancelAll') }} ({{ activeCount(source) }})
                    </button>
                  </div>
                </div>

                <div data-testid="hidden-progress-source-list" class="hidden-progress-source-list custom-scrollbar">
                  <div
                    v-for="task in source.tasks"
                    :key="task.id"
                    data-testid="hidden-progress-task"
                    class="hidden-progress-task-row"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium">
                        {{ t(`progressCenter.kind.${task.kind}`) }}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-xs font-medium" :title="task.label">{{
                        task.label
                      }}</span>
                      <span class="shrink-0 text-[10px] text-text-secondary">{{
                        t(`progressCenter.status.${task.status}`)
                      }}</span>
                      <button
                        v-if="!done(task.status)"
                        type="button"
                        data-testid="hidden-progress-cancel"
                        class="shrink-0 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300"
                        :disabled="task.status === 'cancelling'"
                        @click="emit('cancel', source.id, task.id)"
                      >
                        {{ task.status === 'cancelling' ? t('progressCenter.cancelling') : t('common.cancel') }}
                      </button>
                      <button
                        v-else
                        type="button"
                        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-border/60"
                        :aria-label="t('common.remove')"
                        @click="emit('remove', source.id, task.id)"
                      >
                        <i class="fas fa-times" aria-hidden="true"></i>
                      </button>
                    </div>

                    <div class="mt-1.5 flex items-center gap-2">
                      <div
                        data-testid="hidden-progress-bar"
                        class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-valuenow="Math.round(normalizedProgress(task))"
                      >
                        <div
                          class="h-full rounded-full bg-primary"
                          :style="{ width: `${normalizedProgress(task)}%` }"
                        ></div>
                      </div>
                      <span
                        data-testid="hidden-progress-percent"
                        class="w-11 shrink-0 text-right text-[11px] tabular-nums text-text-secondary"
                      >
                        {{ normalizedProgress(task).toFixed(1) }}%
                      </span>
                    </div>
                    <p v-if="task.warning" class="mb-0 mt-1 text-[11px] text-warning">{{ task.warning }}</p>
                    <p v-if="task.error" class="mb-0 mt-1 text-[11px] text-error">{{ task.error }}</p>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div class="mt-auto flex flex-shrink-0 items-center justify-end border-t border-border px-4 py-4 sm:px-6">
          <button
            type="button"
            data-testid="progress-display-close"
            class="rounded-md bg-button px-4 py-2 text-button-text shadow-sm transition hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            @click="emit('close')"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </section>
  </OverlayPanel>
</template>

<style scoped>
  .progress-display-inline {
    position: static;
    z-index: auto;
    width: 100%;
    max-height: min(48vh, 34rem);
    overflow: hidden;
  }
  .progress-display-inline .transfer-progress-panel {
    max-height: min(48vh, 34rem);
  }
  .progress-display-mobile {
    max-height: calc(85dvh - 2rem);
  }
  .transfer-progress-header {
    border-bottom: 1px solid var(--border-color);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--link-active-color, #007bff) 10%, transparent),
      transparent
    );
  }
  .progress-display-content {
    margin-bottom: 1rem;
    padding-top: 1rem;
  }
  .hidden-progress-source-grid {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .hidden-progress-source-card {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-bg-color) 96%, var(--header-bg-color));
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  }
  .hidden-progress-source-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
    background: color-mix(in srgb, var(--header-bg-color) 88%, transparent);
  }
  .hidden-progress-source-list {
    width: 100%;
    max-height: 260px;
    overflow-y: auto;
    padding: 4px 10px 7px;
  }
  .hidden-progress-task-row {
    padding: 7px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  }
  .hidden-progress-task-row:last-child {
    border-bottom: 0;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 10px;
    background-color: rgba(128, 128, 128, 0.3);
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(128, 128, 128, 0.5);
  }
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
  }
  @media (max-width: 640px) {
    .progress-display-mobile .hidden-progress-source-header {
      align-items: flex-start;
      flex-wrap: wrap;
    }
  }
</style>
