<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BasePanel, BaseSpinner } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  import { useFeedback } from '@/shared/feedback/public';
  import StatusCharts, { type StatusMetric } from './StatusCharts.vue';
  import { useStatusMonitor, type StatusMonitorSessionController } from '../composables/useStatusMonitor';
  import {
    formatStatusDiskPair,
    formatStatusMemoryPair,
    formatStatusPercent,
    formatStatusRate,
    formatStatusSwapPair,
  } from '../model/statusFormatting';

  const props = withDefaults(
    defineProps<{
      session: StatusMonitorSessionController;
      intervalSeconds?: number;
      showIp?: boolean;
      host?: string;
      scale?: number;
    }>(),
    { intervalSeconds: 3, showIp: true, scale: 1 },
  );
  const emit = defineEmits<{ 'update:scale': [scale: number] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const monitor = useStatusMonitor(props.session, () => props.intervalSeconds);
  const localScale = ref(props.scale);
  const selectedMetric = ref<StatusMetric | null>(null);
  const historyRange = ref<1 | 5 | 10 | 30>(5);
  const ranges = [1, 5, 10, 30] as const;
  const hasVisibleData = computed(() => Boolean(monitor.current.value && !monitor.error.value));
  const resolveScale = createWheelScaleResolver({ min: 0.65, max: 1.6, step: 0.1, precision: 2, thresholdPx: 72 });
  const scaleStyle = computed(() => {
    const scale = localScale.value;
    const inverse = 100 / scale;
    return { width: `${inverse}%`, height: `${inverse}%`, transform: `scale(${scale})`, transformOrigin: 'top left' };
  });
  watch(
    () => props.scale,
    (value) => {
      localScale.value = Math.min(1.6, Math.max(0.65, value));
    },
  );
  const handleWheel = (event: WheelEvent) => {
    const change = resolveScale(event, localScale.value);
    if (!change) return;
    localScale.value = change.next;
    emit('update:scale', change.next);
  };
  const copyHost = async () => {
    if (!props.host) return;
    try {
      await writeClipboardText(props.host);
      feedback.notifySuccess(t('common.copied'));
    } catch {
      // Clipboard permissions are browser-controlled.
    }
  };
  const selectMetric = (metric: StatusMetric) => {
    selectedMetric.value = selectedMetric.value === metric ? null : metric;
  };
  const percent = (value?: number) => formatStatusPercent(value) ?? t('statusMonitor.notAvailable');
  const memory = (used?: number, total?: number) =>
    formatStatusMemoryPair(used, total) ?? t('statusMonitor.notAvailable');
  const swap = (used?: number, total?: number) => formatStatusSwapPair(used, total) ?? t('statusMonitor.notAvailable');
  const disk = (used?: number, total?: number) => formatStatusDiskPair(used, total) ?? t('statusMonitor.notAvailable');
</script>

<template>
  <section
    data-testid="status-monitor"
    :data-status-scale="localScale.toFixed(2)"
    class="status-monitor h-full min-h-0 overflow-auto"
    :class="{ 'status-has-data': hasVisibleData }"
    @wheel="handleWheel"
  >
    <div :style="scaleStyle" :data-status-scale="localScale.toFixed(2)" class="status-surface space-y-4">
      <header class="status-header flex min-w-0 items-center justify-between gap-2 text-sm">
        <div class="status-header-main flex min-w-0 items-center justify-between gap-2">
          <strong>{{ t('statusMonitor.title') }}</strong>
          <button
            v-if="showIp && host"
            type="button"
            class="status-touch-target min-w-0 truncate rounded px-2 py-1 text-text-secondary hover:bg-primary/10 hover:text-primary"
            :title="host"
            @click="copyHost"
          >
            ● {{ host }}
          </button>
        </div>
        <div v-if="hasVisibleData" class="status-auto-summary" aria-hidden="true">
          <div class="status-summary-resources">
            <span>{{ t('statusMonitor.cpuLabel') }} {{ percent(monitor.current.value?.cpuPercent) }}</span>
            <span>{{ t('statusMonitor.memoryLabel') }} {{ percent(monitor.current.value?.memPercent) }}</span>
            <span>{{ t('statusMonitor.diskLabel') }} {{ percent(monitor.current.value?.diskPercent) }}</span>
          </div>
          <div class="status-summary-network">
            <span>↓ {{ formatStatusRate(monitor.current.value?.netRxRate) }}</span>
            <span>↑ {{ formatStatusRate(monitor.current.value?.netTxRate) }}</span>
          </div>
        </div>
      </header>
      <div class="status-body">
        <p v-if="monitor.error.value" class="text-error">
          {{ t('statusMonitor.errorPrefix') }} {{ monitor.error.value }}
        </p>
        <BaseSpinner v-else-if="!monitor.current.value" />
        <template v-else>
          <div class="status-metric-grid grid gap-3">
            <button type="button" class="text-left" @click="selectMetric('cpu')">
              <BasePanel :class="selectedMetric === 'cpu' ? 'ring-1 ring-primary' : ''">
                <p class="text-xs text-text-secondary">{{ t('statusMonitor.cpuLabel') }}</p>
                <strong class="text-xl">{{ percent(monitor.current.value.cpuPercent) }}</strong>
                <p v-if="monitor.current.value.cpuModel" class="status-detail truncate text-xs text-text-secondary">
                  {{ monitor.current.value.cpuModel }}
                </p>
              </BasePanel>
            </button>
            <button type="button" class="text-left" @click="selectMetric('memory')">
              <BasePanel :class="selectedMetric === 'memory' ? 'ring-1 ring-primary' : ''">
                <p class="text-xs text-text-secondary">{{ t('statusMonitor.memoryLabel') }}</p>
                <strong>{{ percent(monitor.current.value.memPercent) }}</strong>
                <p class="text-xs text-text-secondary">
                  {{ memory(monitor.current.value.memUsed, monitor.current.value.memTotal) }}
                </p>
              </BasePanel>
            </button>
            <button type="button" class="text-left" @click="selectMetric('swap')">
              <BasePanel :class="selectedMetric === 'swap' ? 'ring-1 ring-primary' : ''">
                <p class="text-xs text-text-secondary">{{ t('statusMonitor.swapLabel') }}</p>
                <strong>{{ percent(monitor.current.value.swapPercent) }}</strong>
                <p class="status-detail text-xs text-text-secondary">
                  {{ swap(monitor.current.value.swapUsed, monitor.current.value.swapTotal) }}
                </p>
              </BasePanel>
            </button>
            <button type="button" class="text-left" @click="selectMetric('disk')">
              <BasePanel :class="selectedMetric === 'disk' ? 'ring-1 ring-primary' : ''">
                <p class="text-xs text-text-secondary">{{ t('statusMonitor.diskLabel') }}</p>
                <strong>{{ percent(monitor.current.value.diskPercent) }}</strong>
                <p class="status-detail text-xs text-text-secondary">
                  {{ disk(monitor.current.value.diskUsed, monitor.current.value.diskTotal) }}
                </p>
              </BasePanel>
            </button>
            <button type="button" class="text-left" @click="selectMetric('network')">
              <BasePanel :class="selectedMetric === 'network' ? 'ring-1 ring-primary' : ''">
                <p class="flex min-w-0 items-center justify-between gap-2 text-xs text-text-secondary">
                  <span>{{ t('statusMonitor.networkLabel') }}</span>
                  <span v-if="monitor.current.value.netInterface" class="truncate">{{
                    monitor.current.value.netInterface
                  }}</span>
                </p>
                <strong class="block text-sm">↓ {{ formatStatusRate(monitor.current.value.netRxRate) }}</strong>
                <strong class="block text-sm">↑ {{ formatStatusRate(monitor.current.value.netTxRate) }}</strong>
              </BasePanel>
            </button>
          </div>

          <div class="text-sm text-text-secondary">
            <span v-if="monitor.current.value.osName"
              >{{ t('statusMonitor.osLabel') }} {{ monitor.current.value.osName }}</span
            >
            <span v-if="monitor.current.value.loadAvg?.length">
              · Load {{ monitor.current.value.loadAvg.map((value) => value.toFixed(2)).join(' / ') }}
            </span>
          </div>

          <section v-if="selectedMetric" class="space-y-2 rounded border border-border p-2">
            <header class="flex flex-wrap items-center justify-between gap-2">
              <strong class="text-sm">{{ t(`statusMonitor.trend.${selectedMetric}`) }}</strong>
              <div class="status-range-tabs flex gap-1">
                <BaseButton
                  v-for="range in ranges"
                  :key="range"
                  class="status-touch-target"
                  size="sm"
                  :variant="historyRange === range ? 'primary' : 'ghost'"
                  @click="historyRange = range"
                  >{{ t('statusMonitor.minutes', { count: range }) }}</BaseButton
                >
              </div>
            </header>
            <StatusCharts
              :history="monitor.history.value"
              :metric="selectedMetric"
              :range-minutes="historyRange"
              :interval-seconds="intervalSeconds"
            />
          </section>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
  .status-monitor {
    container-name: status-pane;
    container-type: size;
    overscroll-behavior: contain;
  }

  .status-metric-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  @container status-pane (min-width: 360px) {
    .status-metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @container status-pane (min-width: 760px) {
    .status-metric-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }

  .status-auto-summary {
    display: none;
  }

  @container status-pane (max-height: 300px) {
    .status-range-tabs {
      display: none;
    }
  }

  @container status-pane (max-height: 235px) {
    .status-has-data {
      overflow: hidden;
    }

    .status-has-data .status-surface {
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .status-has-data .status-header {
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: 0.25rem;
    }

    .status-has-data .status-header-main {
      flex: 0 0 auto;
    }

    .status-has-data .status-auto-summary {
      min-height: 0;
      flex: 1 1 auto;
      display: grid;
      grid-template-rows: repeat(2, minmax(0, 1fr));
      align-items: center;
      gap: 0.2rem;
      padding: 0.25rem 0.5rem;
      color: var(--text-color-secondary);
      font-size: clamp(0.7rem, 5cqw, 0.9rem);
      font-variant-numeric: tabular-nums;
    }

    .status-summary-resources,
    .status-summary-network {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: clamp(0.25rem, 2cqw, 0.6rem);
      white-space: nowrap;
    }

    .status-summary-resources > span,
    .status-summary-network > span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-has-data .status-body {
      display: none;
    }
  }

  @container status-pane (max-width: 180px) and (max-height: 235px) {
    .status-summary-resources,
    .status-summary-network {
      flex-direction: column;
      gap: 0.05rem;
      align-items: stretch;
      text-align: center;
    }
  }

  @container status-pane (max-height: 130px) {
    .status-has-data .status-auto-summary {
      gap: 0;
      padding-block: 0.1rem;
      font-size: clamp(0.58rem, 4.8cqw, 0.72rem);
    }

    .status-has-data .status-header-main {
      font-size: 0.7rem;
    }
  }

  @media (pointer: coarse) {
    .status-touch-target {
      min-height: 44px;
      min-width: 44px;
    }
  }

  @container status-pane (max-height: 260px) {
    .status-surface {
      gap: 0.4rem;
    }

    .status-metric-grid {
      gap: 0.4rem;
    }

    .status-detail {
      display: none;
    }
  }
</style>
