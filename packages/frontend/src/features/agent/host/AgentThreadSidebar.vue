<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiPopover } from '@/foundation/ui';
  import type { AgentRunStatusDto, AgentThreadViewDto } from '../api/agent-api';

  const props = defineProps<{
    open: boolean;
    threads: AgentThreadViewDto[];
    nextCursor: string | null;
    loadingMore: boolean;
    activeThreadCount: number;
    busy: boolean;
    currentThreadId: string | null;
    threadStatuses: Record<string, AgentRunStatusDto | null>;
    threadDeleteArmedId: string | null;
    deleteAllThreadsArmed: boolean;
  }>();

  const emit = defineEmits<{
    close: [];
    newThread: [];
    select: [thread: AgentThreadViewDto];
    deleteThread: [thread: AgentThreadViewDto];
    deleteAll: [];
    loadMore: [];
    pageSize: [value: number];
  }>();

  const { locale } = useI18n();
  const query = ref('');
  const scroller = ref<HTMLElement | null>(null);
  const scrollTop = ref(0);
  const viewportHeight = ref(0);
  const THREAD_ROW_BASE_HEIGHT = 45;
  const THREAD_ROW_GAP = 2; // the wrapper's `mb-0.5`
  const THREAD_PAGE_MIN = 12;
  const THREAD_PAGE_MAX = 100;
  const THREAD_OVERSCAN = 6;
  const SCALE_MIN = 0.8;
  const SCALE_MAX = 1.3;
  const SCALE_DEFAULT = 1;
  const SCALE_STEP = 0.1;
  const SCALE_STORAGE_KEY = 'nexus.agent.thread-list-scale.v1';
  const nonTerminal = new Set<AgentRunStatusDto>([
    'created',
    'running',
    'awaiting_approval',
    'awaiting_budget',
    'awaiting_input',
    'cancelling',
  ]);

  const restoreScale = (): number => {
    if (typeof window === 'undefined') return 1;
    try {
      const stored = window.localStorage.getItem(SCALE_STORAGE_KEY);
      if (!stored) return 1;
      const parsed = Number(stored);
      if (!Number.isFinite(parsed)) return 1;
      return Math.min(SCALE_MAX, Math.max(SCALE_MIN, parsed));
    } catch {
      return 1;
    }
  };

  const scale = ref(restoreScale());
  const zoomMenuOpen = ref(false);
  const zoomPercent = computed(() => Math.round(scale.value * 100));
  const canZoomIn = computed(() => scale.value < SCALE_MAX);
  const canZoomOut = computed(() => scale.value > SCALE_MIN);
  const canResetZoom = computed(() => scale.value !== SCALE_DEFAULT);
  /*
   * §7.13-d：字号 / 内边距全部由 `--agent-thread-scale` 驱动（见 scoped 样式）；
   * §2.8：虚拟列表的行高以前是 `45 × scale` 的手算常量 —— CSS 改了字号/内边距、或用户停在
   * 非默认缩放档时，占位高度与实际行高就会各说各话，滚动位置随之漂移。
   * 现在改量一个复用同一组 class 的**隐藏探针行**：CSS 写什么就跟着走，占位与窗口都自洽。
   */
  const rowProbe = ref<HTMLElement | null>(null);
  const measuredRowHeight = ref<number | null>(null);
  const rowHeight = computed(() => measuredRowHeight.value ?? Math.round(THREAD_ROW_BASE_HEIGHT * scale.value));
  const measureRowHeight = (): void => {
    const probe = rowProbe.value;
    if (!probe) return;
    const measured = probe.getBoundingClientRect().height + THREAD_ROW_GAP;
    if (!Number.isFinite(measured) || measured < 24 || measured > 160) return;
    if (measuredRowHeight.value !== null && Math.abs(measuredRowHeight.value - measured) < 0.05) return;
    measuredRowHeight.value = measured;
  };
  const pageSize = computed(() => {
    const visibleRows = viewportHeight.value > 0 ? Math.ceil(viewportHeight.value / rowHeight.value) : THREAD_PAGE_MIN;
    return Math.min(THREAD_PAGE_MAX, Math.max(THREAD_PAGE_MIN, visibleRows + THREAD_OVERSCAN * 2));
  });
  const statusFor = (threadId: string): AgentRunStatusDto | null => props.threadStatuses[threadId] ?? null;
  const visibleThreads = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return props.threads
      .filter((thread) => !needle || `${thread.title} ${thread.id}`.toLowerCase().includes(needle))
      .slice()
      .sort((left, right) => {
        const leftStatus = statusFor(left.id);
        const rightStatus = statusFor(right.id);
        const leftActive = leftStatus !== null && nonTerminal.has(leftStatus);
        const rightActive = rightStatus !== null && nonTerminal.has(rightStatus);
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        return right.updatedAt - left.updatedAt;
      });
  });
  const windowedThreads = computed(() => {
    const total = visibleThreads.value.length;
    if (total === 0) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, items: [] as AgentThreadViewDto[] };
    const viewportRows = Math.max(1, Math.ceil(viewportHeight.value / rowHeight.value));
    const windowSize = Math.min(total, viewportRows + THREAD_OVERSCAN * 2);
    const rawStart = Math.floor(scrollTop.value / rowHeight.value) - THREAD_OVERSCAN;
    const start = Math.min(Math.max(0, rawStart), Math.max(0, total - windowSize));
    const end = Math.min(total, start + windowSize);
    return {
      start,
      end,
      topSpacer: start * rowHeight.value,
      bottomSpacer: (total - end) * rowHeight.value,
      items: visibleThreads.value.slice(start, end),
    };
  });
  const timeFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }));
  const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }));
  const formatUpdatedAt = (updatedAt: number): string => {
    const date = new Date(updatedAt * 1000);
    return date.toDateString() === new Date().toDateString()
      ? timeFormatter.value.format(date)
      : dateFormatter.value.format(date);
  };

  const syncMetrics = (): void => {
    if (!scroller.value) return;
    scrollTop.value = scroller.value.scrollTop;
    viewportHeight.value = scroller.value.clientHeight;
  };
  const maybeLoadMore = (): void => {
    const element = scroller.value;
    if (!element || query.value || !props.nextCursor || props.loadingMore) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= Math.max(72, rowHeight.value * 3)) emit('loadMore');
  };
  const onScroll = (): void => {
    syncMetrics();
    maybeLoadMore();
  };
  const persistScale = (): void => {
    try {
      window.localStorage.setItem(SCALE_STORAGE_KEY, String(scale.value));
    } catch {
      // View preference persistence is best-effort.
    }
  };
  const clampScale = (value: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 10) / 10));
  // 唯一的缩放写入路径（Ctrl/⌘+滚轮与弹出面板共用）：改字号时保持"当前行"不跳动。
  const applyScale = (next: number): void => {
    const clamped = clampScale(next);
    if (clamped === scale.value) return;
    const element = scroller.value;
    const anchorRow = element ? element.scrollTop / rowHeight.value : 0;
    scale.value = clamped;
    persistScale();
    void nextTick(() => {
      measureRowHeight();
      if (element) element.scrollTop = anchorRow * rowHeight.value;
      syncMetrics();
      maybeLoadMore();
    });
  };
  const stepScale = (direction: 1 | -1): void => applyScale(scale.value + direction * SCALE_STEP);
  const resetScale = (): void => applyScale(SCALE_DEFAULT);
  const onWheel = (event: WheelEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
    const next = clampScale(scale.value + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
    if (next === scale.value) return;
    event.preventDefault();
    applyScale(next);
  };
  const resetScroll = (): void => {
    scrollTop.value = 0;
    query.value = '';
    void nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = 0;
      syncMetrics();
    });
  };

  let resizeObserver: ResizeObserver | null = null;
  watch(query, () => {
    scrollTop.value = 0;
    if (scroller.value) scroller.value.scrollTop = 0;
  });
  watch(pageSize, (value) => emit('pageSize', value), { immediate: true });
  let rowProbeObserver: ResizeObserver | null = null;
  const observeRowProbe = (element: HTMLElement | null): void => {
    rowProbeObserver?.disconnect();
    rowProbeObserver = null;
    if (!element || typeof ResizeObserver === 'undefined') return;
    // `box: 'border-box'` matters: padding-only changes (the `6px * scale` padding above) leave the content
    // box untouched, so the default content-box observation would silently miss them.
    rowProbeObserver = new ResizeObserver(() => measureRowHeight());
    rowProbeObserver.observe(element, { box: 'border-box' });
    measureRowHeight();
  };
  // The probe only exists once the first page of threads arrives, so bind the observer to the ref itself.
  watch(rowProbe, (element) => observeRowProbe(element), { flush: 'post' });

  onMounted(() => {
    syncMetrics();
    measureRowHeight();
    if (scroller.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        syncMetrics();
        maybeLoadMore();
      });
      resizeObserver.observe(scroller.value);
    }
  });
  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    rowProbeObserver?.disconnect();
  });
  defineExpose({ resetScroll });
</script>

<template>
  <aside
    id="agent-thread-sidebar"
    class="agent-thread-sidebar flex min-h-0 flex-col border-r border-border/45 bg-header/30 backdrop-blur-xs select-none"
    :class="{ 'is-open': open }"
    :style="{ '--agent-thread-scale': scale }"
  >
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-border/45 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"></span>
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="text-xs font-semibold leading-none text-foreground">{{ $t('agent.operations.threads') }}</span>
          <span v-if="threads.length" class="text-[11px] font-medium leading-none text-text-secondary/60">
            {{ nextCursor ? `${threads.length}+` : threads.length }}
          </span>
          <span
            v-if="activeThreadCount > 0"
            class="flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-success"
          >
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-success"></span>{{ activeThreadCount }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-0.5">
        <!-- §7.13-d：缩放原本只有 Ctrl/⌘+滚轮这一条不可发现的路径，且没有重置入口 -->
        <UiPopover
          v-model:open="zoomMenuOpen"
          :ariaLabel="$t('agent.operations.threadZoom')"
          :title="$t('agent.operations.threadZoomHint')"
          trigger-appearance="ghost"
          trigger-tone="neutral"
          density="compact"
          align="end"
          placement="bottom"
          :offset="6"
          boundary-selector=".agent-hub-window"
          panel-class="w-44 p-1"
        >
          <template #trigger>
            <span class="tabular-nums">{{ $t('agent.operations.threadZoomValue', { value: zoomPercent }) }}</span>
          </template>
          <template #panel>
            <div class="flex items-center justify-between gap-2 px-2 py-1.5">
              <span class="text-[11px] text-text-secondary">{{ $t('agent.operations.threadZoom') }}</span>
              <span class="text-[11px] font-medium tabular-nums text-foreground">{{
                $t('agent.operations.threadZoomValue', { value: zoomPercent })
              }}</span>
            </div>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-header/60 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canZoomIn"
              @click="stepScale(1)"
            >
              <i class="fa-solid fa-magnifying-glass-plus text-[11px] text-text-secondary" aria-hidden="true"></i>
              <span>{{ $t('agent.operations.threadZoomIn') }}</span>
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-header/60 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canZoomOut"
              @click="stepScale(-1)"
            >
              <i class="fa-solid fa-magnifying-glass-minus text-[11px] text-text-secondary" aria-hidden="true"></i>
              <span>{{ $t('agent.operations.threadZoomOut') }}</span>
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-header/60 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canResetZoom"
              @click="resetScale()"
            >
              <i class="fa-solid fa-rotate-left text-[11px] text-text-secondary" aria-hidden="true"></i>
              <span>{{ $t('agent.operations.threadZoomReset') }}</span>
            </button>
          </template>
        </UiPopover>
        <button
          v-if="threads.length"
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            deleteAllThreadsArmed ? 'bg-error/10 text-error' : 'text-text-secondary hover:bg-error/10 hover:text-error'
          "
          :title="
            activeThreadCount > 0
              ? $t('agent.operations.deleteAllThreadsActiveHint')
              : deleteAllThreadsArmed
                ? $t('agent.operations.confirmDeleteAllThreads')
                : $t('agent.operations.deleteAllThreads')
          "
          :disabled="busy || activeThreadCount > 0"
          @click="emit('deleteAll')"
        >
          <i class="fa-solid fa-trash-can text-[9px]" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-card/70 hover:text-foreground active:scale-95 disabled:opacity-50"
          :title="$t('agent.operations.newThread')"
          :disabled="busy"
          @click="emit('newThread')"
        >
          <i class="fa-solid fa-plus text-[9px] text-primary" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="shrink-0 border-b border-border/40 px-2.5 py-2">
      <div class="relative flex items-center">
        <i
          class="fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
          aria-hidden="true"
        ></i>
        <input
          v-model="query"
          type="search"
          data-no-highlight
          class="h-7 w-full rounded-lg border border-transparent bg-background/55 pl-7.5 pr-7 text-[11px] text-foreground placeholder:text-text-secondary/40 outline-none transition-all hover:bg-card/65 focus:border-primary/20 focus:bg-card/80 focus:ring-2 focus:ring-primary/10"
          :placeholder="$t('agent.operations.searchThreads')"
        />
        <button
          v-if="query"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-secondary hover:text-foreground"
          @click="query = ''"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div
      ref="scroller"
      class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 scrollbar-thin"
      :title="$t('agent.operations.threadZoomHint')"
      @scroll.passive="onScroll"
      @wheel="onWheel"
    >
      <div v-if="threads.length" class="h-0 overflow-hidden" aria-hidden="true">
        <div ref="rowProbe" class="agent-thread-row flex w-full items-center gap-2 rounded-lg px-2 pr-8 text-left">
          <span class="relative mt-px flex h-4 w-3 shrink-0 items-center justify-center">
            <span class="h-1.5 w-1.5 rounded-full"></span>
          </span>
          <div class="min-w-0 flex-1">
            <span class="agent-thread-title block truncate leading-[1.35] tracking-[-0.012em]">Ag</span>
            <div class="agent-thread-meta mt-0.5 flex items-center justify-between gap-1.5">
              <span class="truncate font-mono">#000000</span>
              <span class="shrink-0 tabular-nums">00:00</span>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="windowedThreads.topSpacer > 0"
        :style="{ height: `${windowedThreads.topSpacer}px` }"
        aria-hidden="true"
      ></div>
      <div
        v-for="(thread, offset) in windowedThreads.items"
        :key="thread.id"
        class="group relative mb-0.5"
        :style="{ height: `${Math.max(30, rowHeight - 2)}px` }"
      >
        <button
          type="button"
          class="agent-thread-row relative flex h-full w-full items-center gap-2 rounded-lg px-2 pr-8 text-left transition-[height,background-color,color] duration-150"
          :class="
            currentThreadId === thread.id
              ? 'bg-primary/[0.055] pl-2.5 font-medium text-foreground'
              : 'text-text-secondary hover:bg-card/45 hover:text-foreground'
          "
          :aria-current="currentThreadId === thread.id ? 'true' : undefined"
          :aria-setsize="visibleThreads.length"
          :aria-posinset="windowedThreads.start + offset + 1"
          :disabled="busy"
          @click="emit('select', thread)"
        >
          <span
            v-if="currentThreadId === thread.id"
            class="absolute bottom-2 left-0.5 top-2 w-0.5 rounded-full bg-primary"
          ></span>
          <span class="relative mt-px flex h-4 w-3 shrink-0 items-center justify-center" aria-hidden="true">
            <span
              class="relative z-10 h-1.5 w-1.5 rounded-full transition-colors"
              :class="
                statusFor(thread.id) && nonTerminal.has(statusFor(thread.id)!)
                  ? statusFor(thread.id) === 'awaiting_approval' || statusFor(thread.id) === 'awaiting_budget'
                    ? 'bg-warning'
                    : 'bg-success'
                  : currentThreadId === thread.id
                    ? 'bg-primary'
                    : 'bg-text-secondary/25 group-hover:bg-text-secondary/45'
              "
            ></span>
          </span>
          <div class="min-w-0 flex-1">
            <span
              class="agent-thread-title block truncate leading-[1.35] tracking-[-0.012em] text-foreground/90"
              :title="thread.title || $t('agent.operations.untitledThread')"
            >
              {{ thread.title || $t('agent.operations.untitledThread') }}
            </span>
            <div class="agent-thread-meta mt-0.5 flex items-center justify-between gap-1.5 text-text-secondary/75">
              <span
                v-if="statusFor(thread.id) && nonTerminal.has(statusFor(thread.id)!)"
                class="rounded-sm px-1 py-0.5 font-medium"
                :class="
                  statusFor(thread.id) === 'awaiting_approval' || statusFor(thread.id) === 'awaiting_budget'
                    ? 'bg-warning/15 text-warning'
                    : 'bg-success/15 text-success'
                "
              >
                {{ $t(`agent.tasks.runStatus.${statusFor(thread.id)}`) }}
              </span>
              <span v-else class="truncate font-mono text-text-secondary/45">#{{ thread.id.slice(-6) }}</span>
              <span class="shrink-0 tabular-nums">{{ formatUpdatedAt(thread.updatedAt) }}</span>
            </div>
          </div>
        </button>
        <button
          type="button"
          class="absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            threadDeleteArmedId === thread.id
              ? 'bg-error/10 text-error opacity-100'
              : currentThreadId === thread.id
                ? 'text-text-secondary/70 opacity-100 hover:bg-error/10 hover:text-error'
                : 'text-text-secondary/70 hover:bg-error/10 hover:text-error'
          "
          :title="
            statusFor(thread.id) && nonTerminal.has(statusFor(thread.id)!)
              ? $t('agent.operations.deleteThreadActiveHint')
              : threadDeleteArmedId === thread.id
                ? $t('agent.operations.confirmDeleteThread')
                : $t('agent.operations.deleteThread')
          "
          :disabled="busy || Boolean(statusFor(thread.id) && nonTerminal.has(statusFor(thread.id)!))"
          @click.stop="emit('deleteThread', thread)"
        >
          <i class="fa-solid fa-trash-can text-[9px]" aria-hidden="true"></i>
        </button>
      </div>
      <div
        v-if="windowedThreads.bottomSpacer > 0"
        :style="{ height: `${windowedThreads.bottomSpacer}px` }"
        aria-hidden="true"
      ></div>
      <div
        v-if="loadingMore && !query"
        class="mx-auto mt-1.5 flex h-7 items-center gap-1.5 px-2.5 text-[11px] text-text-secondary/70"
        aria-live="polite"
      >
        <i class="fa-solid fa-spinner fa-spin text-[8px]" aria-hidden="true"></i
        ><span>{{ $t('agent.operations.loading') }}</span>
      </div>
      <div
        v-if="visibleThreads.length === 0"
        class="flex flex-col items-center justify-center rounded-xl bg-background/50 px-3 py-8 text-center"
      >
        <div class="flex h-8 w-8 items-center justify-center rounded-full bg-header text-text-secondary/60">
          <i class="fa-regular fa-comment-dots text-xs" aria-hidden="true"></i>
        </div>
        <p class="mt-2 text-xs text-text-secondary">{{ $t('agent.operations.noThreadsFound') }}</p>
      </div>
    </div>
  </aside>

  <button
    type="button"
    class="agent-thread-backdrop absolute inset-0 z-20 hidden bg-background/55 backdrop-blur-[1px]"
    :class="{ 'is-open': open }"
    :aria-label="$t('agent.operations.closeThreads')"
    @click="emit('close')"
  ></button>
</template>

<style scoped>
  /*
   * §7.13-d：缩放系数只写在根节点的 `--agent-thread-scale` 上，字号与内边距都在这里统一
   * 换算——不再用内联 `font-size`，否则同一份代码在不同机器上侧栏字号可以差 30%。
   * 行高仍然由 JS 计算：虚拟列表要按它算窗口与占位高度。
   */
  .agent-thread-row {
    padding-top: calc(6px * var(--agent-thread-scale, 1));
    padding-bottom: calc(6px * var(--agent-thread-scale, 1));
  }

  .agent-thread-title {
    font-size: calc(10.75px * var(--agent-thread-scale, 1));
  }

  .agent-thread-meta {
    font-size: calc(9px * var(--agent-thread-scale, 1));
  }
</style>
