<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue';
  import type { HostSummaryView } from '../api/agent-api';
  import PluginAppFrame from './PluginAppFrame.vue';
  import AgentAppSwitcher from './AgentAppSwitcher.vue';
  import { builtinAppView } from './builtin-apps';
  import { agentSurfaceSession } from './surface-session';
  import { agentWindowManager } from './window-manager';

  const ArtifactLibraryView = defineAsyncComponent(() => import('../files/ArtifactLibraryView.vue'));

  const props = defineProps<{ summary: HostSummaryView }>();
  const state = agentWindowManager.state;
  const activeApp = computed(() => props.summary.apps.find((app) => app.id === state.activeAppId) ?? null);
  const activeBuiltinView = computed(() => (activeApp.value ? builtinAppView(activeApp.value.id) : null));
  const visible = computed(() => state.status === 'visible');

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
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    pointerId = null;
    mode = null;
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

  const handleResize = () => agentWindowManager.clamp();
  onMounted(() => window.addEventListener('resize', handleResize));
  onBeforeUnmount(() => window.removeEventListener('resize', handleResize));
</script>

<template>
  <section
    v-if="visible"
    class="fixed z-30 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
    :style="style"
    :aria-label="$t('agent.hub.title')"
  >
    <header
      class="flex h-12 shrink-0 touch-none select-none items-center justify-between gap-3 border-b border-border bg-card px-3"
      :class="state.maximized ? '' : 'cursor-move'"
      @pointerdown="begin($event, 'move')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
    >
      <div class="flex min-w-0 items-center gap-3" @pointerdown.stop>
        <span class="font-semibold">{{ $t('agent.hub.title') }}</span>
        <AgentAppSwitcher :apps="summary.apps" :active-app-id="state.activeAppId" @switch="switchApp" />
      </div>
      <div class="flex items-center gap-1" @pointerdown.stop>
        <button
          type="button"
          class="rounded px-2 py-1.5 text-xs hover:bg-header"
          :class="state.hubView === 'conversation' ? 'bg-header' : ''"
          @click="agentWindowManager.setHubView('conversation')"
        >
          {{ $t('agent.hub.conversation') }}
        </button>
        <button
          type="button"
          class="rounded px-2 py-1.5 text-xs hover:bg-header"
          :class="state.hubView === 'files' ? 'bg-header' : ''"
          @click="agentWindowManager.setHubView('files')"
        >
          {{ $t('agent.hub.files') }}
        </button>
        <button
          type="button"
          class="h-8 w-8 rounded hover:bg-header"
          :title="$t('agent.hub.minimize')"
          @click="agentWindowManager.minimizeHub()"
        >
          <i class="fa-solid fa-minus" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="h-8 w-8 rounded hover:bg-header"
          :title="$t('agent.hub.maximize')"
          @click="agentWindowManager.toggleMaximize()"
        >
          <i :class="state.maximized ? 'fa-regular fa-window-restore' : 'fa-regular fa-square'" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="h-8 w-8 rounded hover:bg-header"
          :title="$t('agent.hub.close')"
          @click="agentWindowManager.closeHub()"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1">
      <ArtifactLibraryView v-if="state.hubView === 'files'" :apps="summary.apps" />
      <component
        :is="activeBuiltinView"
        v-else-if="activeApp && activeBuiltinView"
        :key="activeApp.id"
        :app-id="activeApp.id"
      />
      <PluginAppFrame v-else-if="activeApp" :key="`${activeApp.id}@${activeApp.version}`" :app-id="activeApp.id" />
      <div v-else class="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary">
        {{ $t('agent.hub.chooseApp') }}
      </div>
    </div>

    <button
      v-if="!state.maximized"
      type="button"
      class="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none bg-transparent"
      :aria-label="$t('agent.hub.resize')"
      @pointerdown.stop="begin($event, 'resize')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
    ></button>
  </section>
</template>
