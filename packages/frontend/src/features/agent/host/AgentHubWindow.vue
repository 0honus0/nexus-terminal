<script setup lang="ts">
  import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { logger } from '@/client/logging/logger';
  import { structurallyEqual } from '@/foundation/data';
  import { overlayStack, type OverlayStackRegistration } from '@/foundation/ui';
  import type { AgentAppSummaryDto, AgentHostSummaryDto } from '../api/agent-api';
  import PluginAppFrame from './PluginAppFrame.vue';
  import AgentAppSwitcher from './AgentAppSwitcher.vue';
  import { agentSurfaceSession } from './surface-session';
  import { agentWindowManager } from './window-manager';

  const loadAgentAppSurface = () => import('./AgentAppSurface.vue');
  const AgentAppSurface = defineAsyncComponent(loadAgentAppSurface);
  const ArtifactLibraryView = defineAsyncComponent(() => import('../files/ArtifactLibraryView.vue'));

  const props = defineProps<{ summary: AgentHostSummaryDto }>();
  const emit = defineEmits<{ layoutChange: [] }>();
  const state = agentWindowManager.state;
  const activeApp = computed(() => props.summary.apps.find((app) => app.id === state.activeAppId) ?? null);
  const visible = computed(() => state.status === 'visible');
  const hasOpened = ref(visible.value);
  const hubWindowRef = ref<HTMLElement | null>(null);
  let backgroundScrollRestore: (() => void) | null = null;
  let backgroundInteractionRestore: (() => void) | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let lastHubFocus: HTMLElement | null = null;
  let hubOverlayRegistration: OverlayStackRegistration | null = overlayStack.register(visible.value, 50);

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const unlockBackgroundScroll = () => {
    backgroundScrollRestore?.();
    backgroundScrollRestore = null;
  };

  const lockBackgroundScroll = () => {
    if (backgroundScrollRestore || typeof document === 'undefined') return;
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      rootOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
    };
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    backgroundScrollRestore = () => {
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.rootOverscrollBehavior;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
    };
  };

  const unlockBackgroundInteraction = () => {
    backgroundInteractionRestore?.();
    backgroundInteractionRestore = null;
  };

  const lockBackgroundInteraction = () => {
    if (backgroundInteractionRestore || typeof document === 'undefined') return;
    const appRoot = document.getElementById('app');
    if (!appRoot) return;
    const previousInert = appRoot.inert;
    appRoot.inert = true;
    backgroundInteractionRestore = () => {
      appRoot.inert = previousInert;
    };
  };

  const isActuallyFocusable = (element: HTMLElement): boolean => {
    if (!element.isConnected || element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    if (!element.matches(FOCUSABLE_SELECTOR)) return false;
    if (element.closest('[inert]')) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return element.getClientRects().length > 0;
  };

  const getFocusableElements = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isActuallyFocusable);

  const resolveHubOwnedPortal = (target: HTMLElement): HTMLElement | null => {
    const markedPortal = target.closest<HTMLElement>('[data-agent-hub-portal]');
    if (markedPortal) return markedPortal;

    const hub = hubWindowRef.value;
    if (!hub) return null;
    const controlledIds = new Set<string>();
    for (const controller of hub.querySelectorAll<HTMLElement>('[aria-controls]')) {
      const controls = controller.getAttribute('aria-controls');
      if (!controls) continue;
      for (const id of controls.split(/\s+/)) {
        if (id) controlledIds.add(id);
      }
    }

    let current: HTMLElement | null = target;
    while (current && current !== document.body) {
      if (current.id && controlledIds.has(current.id)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const focusHubRoot = () => {
    const hub = hubWindowRef.value;
    if (!hub) return;
    hub.focus({ preventScroll: true });
    lastHubFocus = hub;
  };

  const restoreFocusAfterHide = async (target: HTMLElement | null) => {
    await nextTick();
    if (visible.value) return;
    if (target?.isConnected && isActuallyFocusable(target)) {
      target.focus({ preventScroll: true });
      return;
    }
    const launcher = document.querySelector<HTMLElement>('[data-agent-launcher-trigger]');
    if (launcher && isActuallyFocusable(launcher)) launcher.focus({ preventScroll: true });
  };

  const handleDocumentFocusIn = (event: FocusEvent) => {
    if (!visible.value || !hubOverlayRegistration?.isTop()) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const hub = hubWindowRef.value;
    if (!hub) return;
    if (hub.contains(target)) {
      lastHubFocus = target;
      return;
    }
    if (resolveHubOwnedPortal(target)) return;

    const fallback =
      lastHubFocus?.isConnected && hub.contains(lastHubFocus) && isActuallyFocusable(lastHubFocus) ? lastHubFocus : hub;
    fallback.focus({ preventScroll: true });
  };

  const handleHubKeydown = (event: KeyboardEvent) => {
    if (!visible.value || !hubOverlayRegistration?.isTop()) return;
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      agentWindowManager.closeHub();
      return;
    }
    if (event.key !== 'Tab') return;

    const hub = hubWindowRef.value;
    if (!hub) return;
    const focusables = getFocusableElements(hub);
    if (focusables.length === 0) {
      event.preventDefault();
      focusHubRoot();
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    const index = target ? focusables.indexOf(target) : -1;
    if (index === -1) {
      event.preventDefault();
      (event.shiftKey ? focusables[focusables.length - 1] : focusables[0])?.focus({ preventScroll: true });
      return;
    }
    if (!event.shiftKey && index === focusables.length - 1) {
      event.preventDefault();
      focusables[0]?.focus({ preventScroll: true });
    } else if (event.shiftKey && index === 0) {
      event.preventDefault();
      focusables[focusables.length - 1]?.focus({ preventScroll: true });
    }
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !visible.value || !hubOverlayRegistration?.isTop()) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const portalRoot = resolveHubOwnedPortal(target);
    if (!portalRoot || target === portalRoot) return;

    const portalFocusables = getFocusableElements(portalRoot);
    const index = portalFocusables.indexOf(target);
    if (index === -1) return;
    const hub = hubWindowRef.value;
    if (!hub) return;
    const hubFocusables = getFocusableElements(hub);
    const fallback = hubFocusables[0] ?? hub;
    const reverseFallback = hubFocusables[hubFocusables.length - 1] ?? hub;
    if (!event.shiftKey && index === portalFocusables.length - 1) {
      event.preventDefault();
      fallback.focus({ preventScroll: true });
    } else if (event.shiftKey && index === 0) {
      event.preventDefault();
      reverseFallback.focus({ preventScroll: true });
    }
  };

  watch(
    visible,
    (isVisible, wasVisible) => {
      hubOverlayRegistration?.setVisible(isVisible);
      if (isVisible) {
        hasOpened.value = true;
        if (!wasVisible) {
          const active = document.activeElement;
          previouslyFocused = active instanceof HTMLElement ? active : null;
          lastHubFocus = null;
        }
        lockBackgroundScroll();
        lockBackgroundInteraction();
        void nextTick(() => {
          if (visible.value) focusHubRoot();
        });
      } else {
        unlockBackgroundScroll();
        unlockBackgroundInteraction();
        if (wasVisible) {
          const focusTarget = previouslyFocused;
          previouslyFocused = null;
          lastHubFocus = null;
          void restoreFocusAfterHide(focusTarget);
        }
      }
    },
    { immediate: true },
  );
  const enabledApps = computed(() => props.summary.apps.filter((app) => app.enabled));
  const activityCount = computed(
    () =>
      props.summary.totalRunningRuns + props.summary.totalPendingApprovals + props.summary.totalPendingBudgetRequests,
  );

  let surfacePreloadHandle: number | ReturnType<typeof setTimeout> | null = null;
  let surfacePreloadUsesIdleCallback = false;

  // The Hub is modal by design: while it is open the background app is inert,
  // so the backdrop must keep absorbing pointer/wheel/touch. Clicking outside
  // the window intentionally does nothing (no close, no minimize, no flash).
  const absorbBackdropPointer = () => {};

  // 全局交互单例清理，确保没有残留监听器导致拖拽死锁或互踩
  let activeInteractionCleanup: (() => void) | null = null;

  const cancelActiveInteraction = () => {
    if (activeInteractionCleanup) {
      activeInteractionCleanup();
      activeInteractionCleanup = null;
    }
  };

  /*
   * §2.10：窗口几何此前只有 pointer 路径。这里给标题栏与右下角手柄补上等价的键盘路径
   * （方向键 16px 步进，Shift 64px），让纯键盘用户也能调整窗口位置与大小。
   */
  const KEYBOARD_NUDGE_STEP = 16;
  const KEYBOARD_NUDGE_STEP_LARGE = 64;

  const keyboardDelta = (event: KeyboardEvent): { dx: number; dy: number } | null => {
    const step = event.shiftKey ? KEYBOARD_NUDGE_STEP_LARGE : KEYBOARD_NUDGE_STEP;
    switch (event.key) {
      case 'ArrowLeft':
        return { dx: -step, dy: 0 };
      case 'ArrowRight':
        return { dx: step, dy: 0 };
      case 'ArrowUp':
        return { dx: 0, dy: -step };
      case 'ArrowDown':
        return { dx: 0, dy: step };
      default:
        return null;
    }
  };

  const handleMoveKeydown = (event: KeyboardEvent) => {
    if (state.maximized) return;
    const delta = keyboardDelta(event);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    agentWindowManager.setBounds({
      ...state.bounds,
      x: state.bounds.x + delta.dx,
      y: state.bounds.y + delta.dy,
    });
    emit('layoutChange');
  };

  /*
   * §7.2-f: the title bar dragged and moved by keyboard, but the double click every
   * other window manager maps to maximise / restore did nothing.
   */
  const handleHeaderDoubleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, [role='button'], .no-drag")) return;
    agentWindowManager.toggleMaximize();
    emit('layoutChange');
  };
  const handleResizeKeydown = (event: KeyboardEvent) => {
    if (state.maximized) return;
    const delta = keyboardDelta(event);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    agentWindowManager.resize(state.bounds.width + delta.dx, state.bounds.height + delta.dy);
    emit('layoutChange');
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
      agentWindowManager.resize(startBounds.width + dx, startBounds.height + dy);
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
  type ResidentAppSurface = {
    appId: string;
    version: string;
    surface: 'agent' | 'custom';
    defaultApprovalMode: AgentAppSummaryDto['defaultApprovalMode'];
    health: AgentAppSummaryDto['health'];
    healthReason: string | null;
  };
  const residentAppSurfaces = ref<ResidentAppSurface[]>([]);
  const filesMounted = ref(state.hubView === 'files');
  const residentKey = (surface: Pick<ResidentAppSurface, 'appId' | 'version'>): string =>
    `${surface.appId}@${surface.version}`;
  const toResidentSurface = (app: AgentAppSummaryDto): ResidentAppSurface | null => {
    if (!app.enabled || (app.surface !== 'agent' && app.surface !== 'custom')) return null;
    return {
      appId: app.id,
      version: app.version,
      surface: app.surface,
      defaultApprovalMode: app.defaultApprovalMode,
      health: app.health,
      healthReason: app.healthReason,
    };
  };

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

  const syncResidentSurfaces = (): void => {
    const appsById = new Map(props.summary.apps.map((app) => [app.id, app]));
    const openIds = new Set(openAppIds.value);
    residentAppSurfaces.value = residentAppSurfaces.value.flatMap((resident) => {
      const current = appsById.get(resident.appId);
      if (
        !current ||
        !openIds.has(resident.appId) ||
        !current.enabled ||
        current.version !== resident.version ||
        current.surface !== resident.surface
      ) {
        return [];
      }
      return [
        {
          ...resident,
          defaultApprovalMode: current.defaultApprovalMode,
          health: current.health,
          healthReason: current.healthReason,
        },
      ];
    });

    if (state.hubView === 'files') {
      filesMounted.value = true;
      return;
    }
    if (!state.activeAppId || !openIds.has(state.activeAppId)) return;
    const current = appsById.get(state.activeAppId);
    const next = current ? toResidentSurface(current) : null;
    if (!next) return;
    if (!residentAppSurfaces.value.some((resident) => residentKey(resident) === residentKey(next))) {
      residentAppSurfaces.value = [...residentAppSurfaces.value, next];
    }
  };

  watch(
    () => [
      props.summary.apps
        .map(
          (app) =>
            `${app.id}:${app.version}:${app.enabled ? 1 : 0}:${app.surface}:${app.defaultApprovalMode}:${app.health}:${app.healthReason ?? ''}`,
        )
        .join('|'),
      openAppIds.value.join('|'),
      state.activeAppId,
      state.hubView,
    ],
    syncResidentSurfaces,
    { immediate: true },
  );

  const displayedApps = computed(() => {
    const apps = props.summary.apps;
    const list = openAppIds.value
      .map((id) => apps.find((app) => app.id === id))
      .filter((app): app is AgentAppSummaryDto => !!app);
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
    residentAppSurfaces.value = residentAppSurfaces.value.filter((resident) => resident.appId !== appId);
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

  /*
   * §7.2-a: the composer keeps three rows of height no matter how short the
   * floating window gets. Below 560px the surface compacts it (see
   * AgentConversation.vue) instead of letting it eat the transcript.
   */
  const hubCompact = computed(() => !state.maximized && state.bounds.height < 560);
  /*
   * §7.2-e: the sidebar / rail toggles and the conversation-files view live in the
   * surface, but persistence is driven from here — any of them changing is a layout
   * change that has to reach localStorage.
   */
  watch(
    () => [state.threadSidebarVisible, state.taskRailVisible, state.hubView] as const,
    () => emit('layoutChange'),
  );
  const handleResize = () => {
    const previousBounds = { ...state.bounds };
    agentWindowManager.clamp();
    if (!structurallyEqual(previousBounds, state.bounds)) {
      logger.debug(
        { previousBounds, bounds: { ...state.bounds }, maximized: state.maximized },
        'Agent floating window clamped to viewport',
      );
    }
  };
  onMounted(() => {
    window.addEventListener('resize', handleResize);
    document.addEventListener('focusin', handleDocumentFocusIn, true);
    document.addEventListener('keydown', handleDocumentKeydown, true);
    if ('requestIdleCallback' in window) {
      surfacePreloadUsesIdleCallback = true;
      surfacePreloadHandle = window.requestIdleCallback(() => void loadAgentAppSurface(), { timeout: 1200 });
    } else {
      surfacePreloadHandle = setTimeout(() => void loadAgentAppSurface(), 350);
    }
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
    document.removeEventListener('focusin', handleDocumentFocusIn, true);
    document.removeEventListener('keydown', handleDocumentKeydown, true);
    if (surfacePreloadHandle !== null) {
      if (surfacePreloadUsesIdleCallback && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(surfacePreloadHandle as number);
      } else {
        clearTimeout(surfacePreloadHandle as ReturnType<typeof setTimeout>);
      }
    }
    cancelActiveInteraction();
    hubOverlayRegistration?.unregister();
    hubOverlayRegistration = null;
    previouslyFocused = null;
    lastHubFocus = null;
    unlockBackgroundInteraction();
    unlockBackgroundScroll();
  });
</script>

<template>
  <Transition name="agent-backdrop">
    <div
      v-if="visible"
      class="agent-hub-backdrop fixed inset-0 z-40"
      aria-hidden="true"
      @pointerdown.stop="absorbBackdropPointer"
      @wheel.prevent
      @touchmove.prevent
    />
  </Transition>

  <section
    v-if="hasOpened"
    v-show="visible"
    ref="hubWindowRef"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="agent-hub-window fixed z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl transition-[box-shadow,transform] duration-150"
    :style="style"
    :data-hub-compact="hubCompact ? '' : undefined"
    :aria-label="$t('agent.hub.title')"
    @keydown="handleHubKeydown"
    @wheel.stop
    @touchmove.stop
  >
    <header
      class="agent-hub-header flex h-11 shrink-0 touch-none select-none items-center justify-between gap-2.5 border-b border-border/45 bg-header/45 px-3 backdrop-blur-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/45"
      :class="state.maximized ? '' : 'cursor-move'"
      :tabindex="state.maximized ? -1 : 0"
      :aria-label="$t('agent.hub.moveHandle')"
      :aria-keyshortcuts="state.maximized ? undefined : 'ArrowLeft ArrowRight ArrowUp ArrowDown'"
      @pointerdown="handleDragPointerDown"
      @keydown="handleMoveKeydown"
      @dblclick="handleHeaderDoubleClick"
    >
      <!-- 左侧：Agent 品牌徽标与流体 App 标签栏 -->
      <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <!-- 品牌徽标 -->
        <div class="agent-hub-brand flex shrink-0 items-center gap-1.5 pointer-events-none pr-0.5">
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] text-primary"
          >
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
          </div>
          <div class="agent-hub-title flex items-center gap-1.5">
            <span class="text-[11px] font-semibold leading-none tracking-[-0.015em] text-foreground/90">{{
              $t('agent.hub.title')
            }}</span>
            <span
              v-if="activityCount > 0"
              class="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
            >
              {{ activityCount }}
            </span>
          </div>
        </div>

        <div class="agent-hub-brand-divider h-3 w-px shrink-0 bg-border/45 mx-1"></div>

        <!-- App 标签组 (直接嵌入顶栏，消除二次横切) -->
        <div class="agent-app-tabstrip flex min-w-0 flex-1 self-stretch items-end overflow-x-auto scrollbar-none">
          <div
            v-for="app in displayedApps"
            :key="app.id"
            class="agent-app-tab group relative flex h-8 items-center transition-colors duration-150 select-none no-drag"
            :class="
              app.id === state.activeAppId
                ? 'agent-app-tab-active shrink-0 max-w-64 text-foreground'
                : 'agent-app-tab-inactive shrink min-w-0 max-w-56 text-text-secondary hover:text-foreground'
            "
          >
            <span
              v-if="app.id === state.activeAppId"
              class="agent-app-tab-surface pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              <span class="agent-app-tab-ear agent-app-tab-ear-left"></span>
              <span class="agent-app-tab-ear agent-app-tab-ear-right"></span>
            </span>

            <button
              type="button"
              class="relative z-[1] flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 text-left"
              :class="displayedApps.length > 1 ? 'pr-1' : 'pr-3'"
              :aria-label="$t('agent.hub.switchToApp', { app: app.displayName })"
              :title="app.displayName"
              @pointerdown.stop
              @click="switchApp(app.id)"
            >
              <!-- Chrome-style tab: text first, no leading app icon. -->
              <!-- App 名称 -->
              <span class="agent-app-name min-w-0 flex-1 truncate">{{ app.displayName }}</span>

              <!-- 运行状态指示徽标 -->
              <span
                v-if="app.runningRuns"
                class="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                :title="$t('agent.hub.runningRuns')"
              >
                <i class="fa-solid fa-play mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.runningRuns }}
              </span>
              <span
                v-if="app.pendingApprovals"
                class="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning"
                :title="$t('agent.hub.pendingApprovals')"
              >
                <i class="fa-solid fa-shield-halved mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingApprovals }}
              </span>
              <span
                v-if="app.pendingBudgetRequests"
                class="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning"
                :title="$t('agent.hub.pendingBudget')"
              >
                <i class="fa-solid fa-coins mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingBudgetRequests }}
              </span>
            </button>

            <!-- 关闭 Tab：与切换按钮并列，使用原生 button 的 Enter / Space 语义。 -->
            <button
              v-if="displayedApps.length > 1"
              type="button"
              class="relative z-[1] mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary/60 transition-all hover:bg-foreground/10 hover:text-foreground"
              :title="$t('agent.hub.closeApp', { app: app.displayName })"
              :aria-label="$t('agent.hub.closeApp', { app: app.displayName })"
              @pointerdown.stop
              @click.stop="closeAppTab(app.id, $event)"
            >
              <i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
            </button>
          </div>

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
          class="agent-hub-approval-badge mr-0.5 flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-warning animate-pulse"></span>
          {{ $t('agent.hub.approvals', { count: summary.totalPendingApprovals }) }}
        </span>

        <!-- 悬浮微胶囊分段器 (Segmented Control) -->
        <nav
          class="agent-hub-view-switch flex shrink-0 items-center rounded-md bg-header/45 p-0.5 backdrop-blur-xs"
          :aria-label="$t('agent.hub.views')"
        >
          <button
            type="button"
            class="agent-hub-view-button flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium transition-colors duration-150 select-none"
            :class="
              state.hubView === 'conversation'
                ? 'bg-background/90 text-foreground shadow-xs font-semibold'
                : 'text-text-secondary hover:bg-background/45 hover:text-foreground'
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
            class="agent-hub-view-button flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium transition-colors duration-150 select-none"
            :class="
              state.hubView === 'files'
                ? 'bg-background/90 text-foreground shadow-xs font-semibold'
                : 'text-text-secondary hover:bg-background/45 hover:text-foreground'
            "
            :aria-label="$t('agent.hub.files')"
            :aria-pressed="state.hubView === 'files'"
            @click="agentWindowManager.setHubView('files')"
          >
            <i
              class="text-[11px] transition-colors"
              :class="state.hubView === 'files' ? 'fa-solid fa-folder-open text-warning' : 'fa-regular fa-folder-open'"
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
            :aria-label="$t('agent.hub.minimize')"
            @click="agentWindowManager.minimizeHub()"
          >
            <i class="fa-solid fa-minus text-[11px]" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="flex h-7.5 w-7.5 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground transition-colors"
            :title="$t('agent.hub.maximize')"
            :aria-label="state.maximized ? $t('agent.hub.restore') : $t('agent.hub.maximize')"
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
            :aria-label="$t('agent.hub.close')"
            @click="agentWindowManager.closeHub()"
          >
            <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </header>

    <div class="min-h-0 flex-1 bg-background">
      <ArtifactLibraryView v-if="filesMounted" v-show="state.hubView === 'files'" :apps="summary.apps" />
      <div
        v-for="resident in residentAppSurfaces"
        :key="residentKey(resident)"
        v-show="
          state.hubView !== 'files' && state.activeAppId === resident.appId && activeApp?.version === resident.version
        "
        class="h-full min-h-0"
      >
        <AgentAppSurface
          v-if="resident.surface === 'agent'"
          :app-id="resident.appId"
          :default-approval-mode="resident.defaultApprovalMode"
          :app-health="resident.health"
          :app-health-reason="resident.healthReason"
        />
        <PluginAppFrame v-else :app-id="resident.appId" :version="resident.version" />
      </div>
      <div
        v-if="state.hubView !== 'files' && activeApp && !['agent', 'custom'].includes(activeApp.surface)"
        class="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        {{ $t('agent.hub.noSurface') }}
      </div>
      <div
        v-else-if="state.hubView !== 'files' && !activeApp"
        class="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        {{ $t('agent.hub.chooseApp') }}
      </div>
    </div>

    <button
      v-if="!state.maximized"
      type="button"
      class="absolute bottom-0 right-0 z-40 flex h-6 w-6 touch-none select-none cursor-nwse-resize items-end justify-end rounded-tl-md rounded-br-2xl p-0.5 text-text-secondary/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
      :title="$t('agent.hub.resizeHint')"
      :aria-label="$t('agent.hub.resize')"
      :aria-keyshortcuts="'ArrowLeft ArrowRight ArrowUp ArrowDown'"
      @pointerdown="handleResizePointerDown"
      @keydown="handleResizeKeydown"
    >
      <svg class="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M10.4 1.6A8.8 8.8 0 0 1 1.6 10.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
      </svg>
    </button>
  </section>
</template>

<style scoped>
  .agent-hub-window {
    container-type: inline-size;
    container-name: agent-hub-window;
    overscroll-behavior: contain;
    box-shadow:
      /* Stays black in every theme (overlay is rgb(0 0 0 / 60%) light, /80% dark). */
      0 20px 48px -12px color-mix(in srgb, var(--overlay-bg-color) 37%, transparent),
      0 0 0 1px color-mix(in srgb, var(--border-color) 55%, transparent),
      inset 0 1px 0 0 var(--card-bg-color);
  }

  .agent-hub-backdrop {
    /* 66% of the themed overlay colour lands near the original 40% slate scrim. */
    background-color: color-mix(in srgb, var(--overlay-bg-color) 66%, transparent);
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

  .agent-app-tabstrip {
    gap: 10px;
    padding-inline: 10px;
  }

  .agent-app-tab {
    position: relative;
    margin-bottom: 0;
    border-radius: 9px 9px 0 0;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 500;
    letter-spacing: -0.012em;
  }

  .agent-hub-header {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-header) 82%, var(--color-background)) 0%,
      color-mix(in srgb, var(--color-header) 62%, var(--color-background)) 58%,
      color-mix(in srgb, var(--color-header) 34%, var(--color-background)) 100%
    );
  }

  .agent-app-tab-active {
    z-index: 2;
  }

  .agent-app-tab-surface {
    border-radius: 9px 9px 0 0;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-header) 48%, var(--color-background)) 0%,
      color-mix(in srgb, var(--color-background) 94%, var(--color-header)) 70%,
      var(--color-background) 100%
    );
    box-shadow:
      -1px 0 0 color-mix(in srgb, var(--color-border) 42%, transparent),
      1px 0 0 color-mix(in srgb, var(--color-border) 42%, transparent),
      0 -1px 0 color-mix(in srgb, var(--color-border) 34%, transparent);
  }

  .agent-app-tab-ear {
    position: absolute;
    bottom: 0;
    width: 10px;
    height: 10px;
  }

  .agent-app-tab-ear-left {
    left: -10px;
    border-bottom-right-radius: 10px;
    box-shadow: 5px 5px 0 5px var(--color-background);
  }

  .agent-app-tab-ear-right {
    right: -10px;
    border-bottom-left-radius: 10px;
    box-shadow: -5px 5px 0 5px var(--color-background);
  }

  .agent-app-tab-inactive {
    margin-bottom: 2px;
    border-radius: 8px;
    background: transparent;
  }

  .agent-app-tab-inactive:hover {
    background: color-mix(in srgb, var(--color-card) 56%, transparent);
  }

  .agent-app-name {
    font-size: 12px;
    line-height: 1.3;
    font-weight: 500;
    letter-spacing: -0.012em;
  }

  .agent-hub-view-button {
    font-size: 11px;
    line-height: 1;
  }

  @container agent-hub-window (max-width: 900px) {
    .agent-hub-view-switch {
      gap: 1px;
      padding: 2px;
    }

    .agent-hub-view-button {
      width: 28px;
      padding-inline: 0;
      justify-content: center;
    }

    .agent-hub-nav-label {
      display: none;
    }
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
