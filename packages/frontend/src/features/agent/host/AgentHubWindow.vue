<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { logger } from '@/client/logging/logger';
  import type { AgentAppSummary, HostSummaryView } from '../api/agent-api';
  import AgentAppSurface from './AgentAppSurface.vue';
  import PluginAppFrame from './PluginAppFrame.vue';
  import AgentAppSwitcher from './AgentAppSwitcher.vue';
  import { agentSurfaceSession } from './surface-session';
  import { agentWindowManager } from './window-manager';

  const ArtifactLibraryView = defineAsyncComponent(() => import('../files/ArtifactLibraryView.vue'));

  const props = defineProps<{ summary: HostSummaryView }>();
  const emit = defineEmits<{ layoutChange: [] }>();
  const state = agentWindowManager.state;
  const activeApp = computed(() => props.summary.apps.find((app) => app.id === state.activeAppId) ?? null);
  const visible = computed(() => state.status === 'visible');
  const enabledApps = computed(() => props.summary.apps.filter((app) => app.enabled));
  const activityCount = computed(
    () =>
      props.summary.totalRunningRuns + props.summary.totalPendingApprovals + props.summary.totalPendingBudgetRequests,
  );

  const flashWindow = ref(false);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const handleBackdropPointerDown = () => {
    flashWindow.value = true;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashWindow.value = false;
    }, 400);
  };

  // 全局交互单例清理，确保没有残留监听器导致拖拽死锁或互踩
  let activeInteractionCleanup: (() => void) | null = null;

  const cancelActiveInteraction = () => {
    if (activeInteractionCleanup) {
      activeInteractionCleanup();
      activeInteractionCleanup = null;
    }
  };

  const handleDragPointerDown = (event: PointerEvent) => {
    if (state.maximized || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, [role='button'], .no-drag")) {
      return;
    }

    cancelActiveInteraction();

    event.preventDefault();
    const currentTarget = event.currentTarget as HTMLElement | null;
    const pointerId = event.pointerId;

    if (currentTarget && typeof currentTarget.setPointerCapture === 'function') {
      try {
        currentTarget.setPointerCapture(pointerId);
      } catch {
        // fallback to window listeners
      }
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = { ...state.bounds };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== undefined && pointerId !== undefined && e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      agentWindowManager.setBounds({
        ...startBounds,
        x: startBounds.x + dx,
        y: startBounds.y + dy,
      });
    };

    const cleanup = () => {
      if (currentTarget && typeof currentTarget.releasePointerCapture === 'function') {
        try {
          if (currentTarget.hasPointerCapture(pointerId)) {
            currentTarget.releasePointerCapture(pointerId);
          }
        } catch {}
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onBlur);
      if (currentTarget) {
        currentTarget.removeEventListener('lostpointercapture', onPointerEnd);
      }
      activeInteractionCleanup = null;
      emit('layoutChange');
    };

    const onBlur = () => cleanup();
    const onPointerEnd = (e?: PointerEvent) => {
      if (e && e.pointerId !== undefined && pointerId !== undefined && e.pointerId !== pointerId) return;
      cleanup();
    };

    activeInteractionCleanup = cleanup;

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('blur', onBlur);
    if (currentTarget) {
      currentTarget.addEventListener('lostpointercapture', onPointerEnd, { once: true });
    }
  };

  const handleResizePointerDown = (event: PointerEvent) => {
    if (state.maximized || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    cancelActiveInteraction();

    const currentTarget = event.currentTarget as HTMLElement | null;
    const pointerId = event.pointerId;

    if (currentTarget && typeof currentTarget.setPointerCapture === 'function') {
      try {
        currentTarget.setPointerCapture(pointerId);
      } catch {}
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = { ...state.bounds };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== undefined && pointerId !== undefined && e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      agentWindowManager.setBounds({
        ...startBounds,
        width: startBounds.width + dx,
        height: startBounds.height + dy,
      });
    };

    const cleanup = () => {
      if (currentTarget && typeof currentTarget.releasePointerCapture === 'function') {
        try {
          if (currentTarget.hasPointerCapture(pointerId)) {
            currentTarget.releasePointerCapture(pointerId);
          }
        } catch {}
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onBlur);
      if (currentTarget) {
        currentTarget.removeEventListener('lostpointercapture', onPointerEnd);
      }
      activeInteractionCleanup = null;
      emit('layoutChange');
    };

    const onBlur = () => cleanup();
    const onPointerEnd = (e?: PointerEvent) => {
      if (e && e.pointerId !== undefined && pointerId !== undefined && e.pointerId !== pointerId) return;
      cleanup();
    };

    activeInteractionCleanup = cleanup;

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('blur', onBlur);
    if (currentTarget) {
      currentTarget.addEventListener('lostpointercapture', onPointerEnd, { once: true });
    }
  };

  const openAppIds = ref<string[]>([]);

  watch(
    () => [props.summary.apps, state.activeAppId] as const,
    ([apps, activeId]) => {
      const enabled = apps.filter((app) => app.enabled).map((app) => app.id);
      const availableIds = enabled;
      if (openAppIds.value.length === 0) {
        openAppIds.value = enabled.length > 0 ? [...enabled] : availableIds[0] ? [availableIds[0]] : [];
      } else {
        openAppIds.value = openAppIds.value.filter((id) => availableIds.includes(id));
      }
      if (activeId && availableIds.includes(activeId) && !openAppIds.value.includes(activeId)) {
        openAppIds.value.push(activeId);
      }
      if (openAppIds.value.length === 0 && availableIds[0]) {
        openAppIds.value = [availableIds[0]];
      }
    },
    { immediate: true },
  );

  const displayedApps = computed(() => {
    const apps = props.summary.apps;
    const list = openAppIds.value
      .map((id) => apps.find((app) => app.id === id))
      .filter((app): app is AgentAppSummary => !!app);
    return list.length > 0 ? list : enabledApps.value;
  });

  const switchApp = (appId: string) => {
    if (!appId) return;
    if (!openAppIds.value.includes(appId)) {
      openAppIds.value.push(appId);
    }
    if (appId === state.activeAppId) return;
    if (state.activeAppId) agentSurfaceSession.pauseDetail(state.activeAppId);
    agentSurfaceSession.activateApp(appId);
    agentWindowManager.switchApp({ appId });
  };

  const closeAppTab = (appId: string, event?: Event) => {
    event?.stopPropagation();
    if (openAppIds.value.length <= 1) return;
    const index = openAppIds.value.indexOf(appId);
    if (index === -1) return;
    const remaining = openAppIds.value.filter((id) => id !== appId);
    openAppIds.value = remaining;
    if (state.activeAppId === appId) {
      const nextIndex = Math.min(index, remaining.length - 1);
      const nextId = remaining[nextIndex];
      if (nextId) {
        switchApp(nextId);
      }
    }
  };

  const style = computed(() => {
    if (state.maximized) {
      return {
        left: '0px',
        top: '0px',
        right: '0px',
        bottom: '0px',
        width: '100vw',
        height: '100dvh',
        borderRadius: '0px',
        border: 'none',
      };
    }
    return {
      left: `${state.bounds.x}px`,
      top: `${state.bounds.y}px`,
      width: `${state.bounds.width}px`,
      height: `${state.bounds.height}px`,
    };
  });

  const handleResize = () => {
    const previousBounds = { ...state.bounds };
    agentWindowManager.clamp();
    if (JSON.stringify(previousBounds) !== JSON.stringify(state.bounds)) {
      logger.debug(
        { previousBounds, bounds: { ...state.bounds }, maximized: state.maximized },
        'Agent floating window clamped to viewport',
      );
    }
  };
  onMounted(() => window.addEventListener('resize', handleResize));
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
    if (flashTimer) clearTimeout(flashTimer);
    cancelActiveInteraction();
  });
</script>

<template>
  <Transition name="agent-backdrop">
    <div
      v-if="visible"
      class="agent-hub-backdrop fixed inset-0 z-40"
      aria-hidden="true"
      @pointerdown.stop="handleBackdropPointerDown"
      @wheel.prevent
      @touchmove.prevent
    />
  </Transition>

  <section
    v-if="visible"
    role="dialog"
    aria-modal="true"
    class="agent-hub-window fixed z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl transition-[box-shadow,transform] duration-150"
    :class="flashWindow ? 'ring-2 ring-primary/60 scale-[1.002]' : ''"
    :style="style"
    :aria-label="$t('agent.hub.title')"
  >
    <header
      class="agent-hub-header flex h-11 shrink-0 touch-none select-none items-center justify-between gap-2.5 border-b border-border/60 bg-header/65 px-3 backdrop-blur-md"
      :class="state.maximized ? '' : 'cursor-move'"
      @pointerdown="handleDragPointerDown"
    >
      <!-- 左侧：Agent 品牌徽标与流体 App 标签栏 -->
      <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <!-- 品牌徽标 -->
        <div class="agent-hub-brand flex shrink-0 items-center gap-2 pointer-events-none pr-1">
          <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs text-primary shadow-2xs"
          >
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
          </div>
          <div class="agent-hub-title flex items-center gap-1.5">
            <span class="text-xs font-semibold leading-none tracking-tight">{{ $t('agent.hub.title') }}</span>
            <span
              v-if="activityCount > 0"
              class="rounded-full bg-primary/15 px-1.5 py-0.2 text-[10px] font-semibold text-primary"
            >
              {{ activityCount }}
            </span>
          </div>
        </div>

        <div class="agent-hub-brand-divider h-3.5 w-px shrink-0 bg-border/60 mx-0.5"></div>

        <!-- App 标签组 (直接嵌入顶栏，消除二次横切) -->
        <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          <button
            v-for="app in displayedApps"
            :key="app.id"
            type="button"
            class="group flex h-7.5 items-center gap-2 rounded-lg border text-xs transition-all select-none no-drag"
            :class="
              app.id === state.activeAppId
                ? 'shrink-0 border-border/70 bg-card font-semibold text-foreground shadow-xs ring-1 ring-border/20 pl-2.5 pr-1.5 max-w-64'
                : 'shrink min-w-0 border-transparent bg-transparent text-text-secondary hover:border-border/40 hover:bg-card/60 hover:text-foreground pl-2.5 pr-1.5 max-w-56'
            "
            :aria-label="$t('agent.hub.switchToApp', { app: app.displayName })"
            :title="app.displayName"
            @pointerdown.stop
            @click="switchApp(app.id)"
          >
            <!-- App 身份图标与呼吸健康指示灯 -->
            <span class="relative flex items-center justify-center shrink-0">
              <i
                v-if="app.surface === 'agent'"
                class="fa-solid fa-wand-magic-sparkles text-[11px] transition-colors"
                :class="app.id === state.activeAppId ? 'text-primary' : 'text-text-secondary/70'"
                aria-hidden="true"
              ></i>
              <i
                v-else-if="app.surface === 'custom'"
                class="fa-solid fa-puzzle-piece text-[11px] transition-colors"
                :class="app.id === state.activeAppId ? 'text-amber-500' : 'text-text-secondary/70'"
                aria-hidden="true"
              ></i>
              <i v-else class="fa-solid fa-layer-group text-[11px] text-text-secondary/70" aria-hidden="true"></i>
              <span
                class="absolute -bottom-0.5 -right-1 h-1.5 w-1.5 rounded-full ring-1 ring-background transition-all"
                :class="
                  app.health === 'healthy'
                    ? 'bg-success shadow-[0_0_4px_rgba(16,185,129,0.5)]'
                    : app.health === 'degraded'
                      ? 'bg-warning shadow-[0_0_4px_rgba(245,158,11,0.5)]'
                      : 'bg-text-secondary/40'
                "
              ></span>
            </span>

            <!-- App 名称 -->
            <span class="truncate min-w-0 tracking-[-0.01em]">{{ app.displayName }}</span>

            <!-- 运行状态指示徽标 -->
            <span
              v-if="app.runningRuns"
              class="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary"
              :title="$t('agent.hub.runningRuns')"
            >
              <i class="fa-solid fa-play mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.runningRuns }}
            </span>
            <span
              v-if="app.pendingApprovals"
              class="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[9px] font-medium text-warning"
              :title="$t('agent.hub.pendingApprovals')"
            >
              <i class="fa-solid fa-shield-halved mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingApprovals }}
            </span>
            <span
              v-if="app.pendingBudgetRequests"
              class="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[9px] font-medium text-warning"
              :title="$t('agent.hub.pendingBudget')"
            >
              <i class="fa-solid fa-coins mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingBudgetRequests }}
            </span>

            <!-- 关闭 Tab 按钮 -->
            <span
              v-if="displayedApps.length > 1"
              role="button"
              tabindex="0"
              class="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md transition-colors text-text-secondary/45 hover:bg-foreground/10 hover:text-foreground"
              :title="$t('agent.hub.closeApp', { app: app.displayName })"
              :aria-label="$t('agent.hub.closeApp', { app: app.displayName })"
              @click.stop="closeAppTab(app.id, $event)"
              @keydown.enter.stop="closeAppTab(app.id, $event)"
            >
              <i class="fa-solid fa-xmark text-[9px]" aria-hidden="true"></i>
            </span>
          </button>

          <!-- 新建 App 按钮 -->
          <div class="flex shrink-0 items-center" @pointerdown.stop>
            <AgentAppSwitcher :apps="summary.apps" :active-app-id="state.activeAppId" @switch="switchApp" />
          </div>
        </div>
      </div>

      <!-- 右侧：会话/文件磨砂微胶囊分段器 + 窗口控制 -->
      <div class="flex shrink-0 items-center gap-1.5" @pointerdown.stop>
        <span
          v-if="summary.totalPendingApprovals > 0"
          class="agent-hub-approval-badge mr-0.5 flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[9px] font-medium text-warning"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-warning animate-pulse"></span>
          {{ $t('agent.hub.approvals', { count: summary.totalPendingApprovals }) }}
        </span>

        <!-- 悬浮微胶囊分段器 (Segmented Control) -->
        <nav
          class="flex shrink-0 items-center rounded-lg border border-border/70 bg-header/80 p-0.5 shadow-2xs backdrop-blur-xs"
          :aria-label="$t('agent.hub.views')"
        >
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 select-none"
            :class="
              state.hubView === 'conversation'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/20'
                : 'text-text-secondary hover:text-foreground'
            "
            :aria-label="$t('agent.hub.conversation')"
            :aria-pressed="state.hubView === 'conversation'"
            @click="agentWindowManager.setHubView('conversation')"
          >
            <i
              class="text-[11px] transition-colors"
              :class="state.hubView === 'conversation' ? 'fa-solid fa-message text-primary' : 'fa-regular fa-message'"
              aria-hidden="true"
            ></i>
            <span class="agent-hub-nav-label">{{ $t('agent.hub.conversation') }}</span>
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 select-none"
            :class="
              state.hubView === 'files'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/20'
                : 'text-text-secondary hover:text-foreground'
            "
            :aria-label="$t('agent.hub.files')"
            :aria-pressed="state.hubView === 'files'"
            @click="agentWindowManager.setHubView('files')"
          >
            <i
              class="text-[11px] transition-colors"
              :class="
                state.hubView === 'files' ? 'fa-solid fa-folder-open text-amber-500' : 'fa-regular fa-folder-open'
              "
              aria-hidden="true"
            ></i>
            <span class="agent-hub-nav-label">{{ $t('agent.hub.files') }}</span>
          </button>
        </nav>

        <div class="h-3.5 w-px shrink-0 bg-border/60 mx-0.5"></div>

        <!-- 窗口操作按键 -->
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            class="flex h-7.5 w-7.5 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground transition-colors"
            :title="$t('agent.hub.minimize')"
            @click="agentWindowManager.minimizeHub()"
          >
            <i class="fa-solid fa-minus text-[11px]" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="flex h-7.5 w-7.5 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground transition-colors"
            :title="$t('agent.hub.maximize')"
            @click="agentWindowManager.toggleMaximize()"
          >
            <i
              :class="state.maximized ? 'fa-regular fa-window-restore' : 'fa-regular fa-square'"
              class="text-[11px]"
              aria-hidden="true"
            ></i>
          </button>
          <button
            type="button"
            class="flex h-7.5 w-7.5 items-center justify-center rounded-lg text-text-secondary hover:bg-error/10 hover:text-error transition-colors"
            :title="$t('agent.hub.close')"
            @click="agentWindowManager.closeHub()"
          >
            <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </header>

    <div class="min-h-0 flex-1 bg-background">
      <ArtifactLibraryView v-if="state.hubView === 'files'" :apps="summary.apps" />
      <AgentAppSurface
        v-else-if="activeApp?.surface === 'agent'"
        :key="`${activeApp.id}@${activeApp.version}`"
        :app-id="activeApp.id"
      />
      <PluginAppFrame
        v-else-if="activeApp?.surface === 'custom'"
        :key="`${activeApp.id}@${activeApp.version}`"
        :app-id="activeApp.id"
      />
      <div
        v-else-if="activeApp"
        class="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        {{ $t('agent.hub.noSurface') }}
      </div>
      <div v-else class="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary">
        {{ $t('agent.hub.chooseApp') }}
      </div>
    </div>

    <button
      v-if="!state.maximized"
      type="button"
      class="group absolute bottom-0 right-0 z-40 flex h-4 w-4 touch-none select-none cursor-nwse-resize items-end justify-end rounded-tl-md rounded-br-2xl border-l border-t border-border/40 bg-header/60 p-0.5 text-text-secondary/50 transition-all hover:bg-header hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
      :title="$t('agent.hub.resize')"
      :aria-label="$t('agent.hub.resize')"
      @pointerdown="handleResizePointerDown"
    >
      <svg class="h-2 w-2" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
        <circle cx="7" cy="7" r="0.8" />
        <circle cx="7" cy="4" r="0.8" />
        <circle cx="4" cy="7" r="0.8" />
      </svg>
    </button>
  </section>
</template>

<style scoped>
  .agent-hub-window {
    container-type: inline-size;
    container-name: agent-hub-window;
    box-shadow:
      0 20px 48px -12px rgba(0, 0, 0, 0.22),
      0 0 0 1px rgba(0, 0, 0, 0.05),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.2);
  }

  .agent-hub-backdrop {
    background-color: rgba(15, 23, 42, 0.4);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .agent-backdrop-enter-active,
  .agent-backdrop-leave-active {
    transition: opacity 0.2s ease;
  }

  .agent-backdrop-enter-from,
  .agent-backdrop-leave-to {
    opacity: 0;
  }

  @container agent-hub-window (max-width: 900px) {
    .agent-hub-approval-badge {
      display: none;
    }
  }

  .scrollbar-none::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-none {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  @container agent-hub-window (max-width: 760px) {
    .agent-hub-brand {
      display: none;
    }
    .agent-hub-brand-divider {
      display: none;
    }
    .agent-hub-nav-label {
      display: none;
    }
  }
</style>
