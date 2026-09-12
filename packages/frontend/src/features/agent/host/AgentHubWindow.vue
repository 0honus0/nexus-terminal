<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue';
  import { logger } from '@/client/logging/logger';
  import type { HostSummaryView } from '../api/agent-api';
  import AgentAppSurface from './AgentAppSurface.vue';
  import PluginAppFrame from './PluginAppFrame.vue';
  import AgentAppSwitcher from './AgentAppSwitcher.vue';
  import { builtinAppView } from './builtin-apps';
  import { agentSurfaceSession } from './surface-session';
  import { agentWindowManager } from './window-manager';

  const ArtifactLibraryView = defineAsyncComponent(() => import('../files/ArtifactLibraryView.vue'));

  const props = defineProps<{ summary: HostSummaryView }>();
  const emit = defineEmits<{ layoutChange: [] }>();
  const state = agentWindowManager.state;
  const activeApp = computed(() => props.summary.apps.find((app) => app.id === state.activeAppId) ?? null);
  const activeBuiltinView = computed(() => (activeApp.value ? builtinAppView(activeApp.value.id) : null));
  const visible = computed(() => state.status === 'visible');
  const enabledApps = computed(() => props.summary.apps.filter((app) => app.enabled));
  const activityCount = computed(
    () =>
      props.summary.totalRunningRuns + props.summary.totalPendingApprovals + props.summary.totalPendingBudgetRequests,
  );

  let mode: 'move' | 'resize' | null = null;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startBounds = { ...state.bounds };

  const begin = (event: PointerEvent, nextMode: 'move' | 'resize') => {
    if (state.maximized || event.button !== 0) return;
    mode = nextMode;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startBounds = { ...state.bounds };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent) => {
    if (pointerId !== event.pointerId || !mode) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (mode === 'move') {
      agentWindowManager.setBounds({ ...startBounds, x: startBounds.x + dx, y: startBounds.y + dy });
    } else {
      agentWindowManager.setBounds({ ...startBounds, width: startBounds.width + dx, height: startBounds.height + dy });
    }
  };

  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const completedMode = mode;
    const previousBounds = { ...startBounds };
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    pointerId = null;
    mode = null;
    emit('layoutChange');
    if (completedMode) {
      logger.debug(
        {
          interaction: completedMode,
          previousBounds,
          bounds: { ...state.bounds },
          maximized: state.maximized,
          activeAppId: state.activeAppId,
        },
        'Agent floating window pointer interaction completed',
      );
    }
  };

  const switchApp = (appId: string) => {
    if (!appId || appId === state.activeAppId) return;
    if (state.activeAppId) agentSurfaceSession.pauseDetail(state.activeAppId);
    agentSurfaceSession.activateApp(appId);
    agentWindowManager.switchApp({ appId });
  };

  const style = computed(() => {
    if (state.maximized) return { left: '12px', top: '64px', right: '12px', bottom: '12px' };
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
  onBeforeUnmount(() => window.removeEventListener('resize', handleResize));
</script>

<template>
  <section
    v-if="visible"
    role="dialog"
    aria-modal="false"
    class="agent-hub-window fixed z-30 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl"
    :style="style"
    :aria-label="$t('agent.hub.title')"
  >
    <header
      class="flex h-14 shrink-0 touch-none select-none items-center justify-between gap-3 border-b border-border/60 bg-card/90 px-3.5"
      :class="state.maximized ? '' : 'cursor-move'"
      @pointerdown="begin($event, 'move')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
    >
      <div class="flex min-w-0 items-center gap-2.5" @pointerdown.stop>
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm text-primary">
          <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
        </div>
        <div class="agent-hub-title min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold leading-none">{{ $t('agent.hub.title') }}</span>
            <span
              v-if="activityCount > 0"
              class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
            >
              {{ activityCount }}
            </span>
          </div>
          <div class="mt-1 text-[10px] text-text-secondary">{{ $t('agent.hub.workspace') }}</div>
        </div>
        <AgentAppSwitcher :apps="summary.apps" :active-app-id="state.activeAppId" @switch="switchApp" />
      </div>

      <nav
        class="flex shrink-0 items-center rounded-lg border border-border/70 bg-background/70 p-0.5"
        :aria-label="$t('agent.hub.views')"
        @pointerdown.stop
      >
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors"
          :class="
            state.hubView === 'conversation'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-text-secondary hover:text-foreground'
          "
          @click="agentWindowManager.setHubView('conversation')"
        >
          <i class="fa-regular fa-message text-[10px]" aria-hidden="true"></i>
          <span class="agent-hub-nav-label">{{ $t('agent.hub.conversation') }}</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors"
          :class="
            state.hubView === 'files'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-text-secondary hover:text-foreground'
          "
          @click="agentWindowManager.setHubView('files')"
        >
          <i class="fa-regular fa-folder-open text-[10px]" aria-hidden="true"></i>
          <span class="agent-hub-nav-label">{{ $t('agent.hub.files') }}</span>
        </button>
      </nav>

      <div class="flex shrink-0 items-center gap-0.5" @pointerdown.stop>
        <span
          v-if="summary.totalPendingApprovals > 0"
          class="agent-hub-approval-badge mr-1 flex items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-[9px] font-medium text-warning"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-warning"></span>
          {{ $t('agent.hub.approvals', { count: summary.totalPendingApprovals }) }}
        </span>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground"
          :title="$t('agent.hub.minimize')"
          @click="agentWindowManager.minimizeHub()"
        >
          <i class="fa-solid fa-minus text-[11px]" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground"
          :title="$t('agent.hub.maximize')"
          @click="agentWindowManager.toggleMaximize()"
        >
          <i :class="state.maximized ? 'fa-regular fa-window-restore' : 'fa-regular fa-square'" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-error/10 hover:text-error"
          :title="$t('agent.hub.close')"
          @click="agentWindowManager.closeHub()"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    <div
      v-if="enabledApps.length > 1"
      class="agent-hub-activity flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 bg-card/35 px-3.5"
      :aria-label="$t('agent.hub.appActivity')"
      @pointerdown.stop
    >
      <span class="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
        {{ $t('agent.hub.apps') }}
      </span>
      <button
        v-for="app in enabledApps"
        :key="app.id"
        type="button"
        class="flex h-7 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[10px] transition-colors"
        :class="
          app.id === state.activeAppId
            ? 'border-primary/20 bg-primary/10 font-semibold text-foreground'
            : 'border-transparent bg-transparent text-text-secondary hover:bg-header/70 hover:text-foreground'
        "
        :aria-label="$t('agent.hub.switchToApp', { app: app.displayName })"
        @click="switchApp(app.id)"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="
            app.health === 'healthy' ? 'bg-success' : app.health === 'degraded' ? 'bg-warning' : 'bg-text-secondary/50'
          "
        ></span>
        <span class="max-w-32 truncate">{{ app.displayName }}</span>
        <span
          v-if="app.runningRuns"
          class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary"
          :title="$t('agent.hub.runningRuns')"
        >
          <i class="fa-solid fa-play mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.runningRuns }}
        </span>
        <span
          v-if="app.pendingApprovals"
          class="rounded-md bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning"
          :title="$t('agent.hub.pendingApprovals')"
        >
          <i class="fa-solid fa-shield-halved mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingApprovals }}
        </span>
        <span
          v-if="app.pendingBudgetRequests"
          class="rounded-md bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning"
          :title="$t('agent.hub.pendingBudget')"
        >
          <i class="fa-solid fa-coins mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingBudgetRequests }}
        </span>
      </button>
    </div>

    <div class="min-h-0 flex-1 bg-background">
      <ArtifactLibraryView v-if="state.hubView === 'files'" :apps="summary.apps" />
      <component
        :is="activeBuiltinView"
        v-else-if="activeApp && activeBuiltinView"
        :key="activeApp.id"
        :app-id="activeApp.id"
      />
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
      class="group absolute bottom-0 right-0 z-40 h-8 w-8 cursor-nwse-resize touch-none rounded-tl-xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="$t('agent.hub.resize')"
      @pointerdown.stop="begin($event, 'resize')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
    >
      <span
        class="absolute bottom-[7px] right-[5px] h-px w-4 -rotate-45 rounded-full bg-text-secondary/35 transition-colors group-hover:bg-primary/70"
      ></span>
      <span
        class="absolute bottom-[6px] right-[11px] h-px w-2.5 -rotate-45 rounded-full bg-text-secondary/25 transition-colors group-hover:bg-primary/50"
      ></span>
    </button>
  </section>
</template>

<style scoped>
  .agent-hub-window {
    container-type: inline-size;
    container-name: agent-hub-window;
  }

  @container agent-hub-window (max-width: 900px) {
    .agent-hub-approval-badge {
      display: none;
    }
  }

  @container agent-hub-window (max-width: 700px) {
    .agent-hub-title,
    .agent-hub-nav-label,
    .agent-hub-activity {
      display: none;
    }
  }
</style>
