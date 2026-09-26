<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
  import type { AgentAppSummaryDto } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummaryDto[]; activeAppId: string | null }>();
  const emit = defineEmits<{ switch: [appId: string] }>();

  const open = ref(false);
  const query = ref('');
  const triggerRef = ref<HTMLButtonElement | null>(null);
  const panelRef = ref<HTMLElement | null>(null);
  const position = ref({ left: '0px', top: '0px', maxWidth: '0px', maxHeight: '0px' });
  /*
   * Same guard as the composer popovers: the placeholder caps make the panel
   * collapse to zero, so anything measured before they are released is wrong
   * (this one silently fell back to 260x220 and placed the panel accordingly
   * for one frame). Nothing is painted until the real measurement lands.
   */
  const positioned = ref(false);
  let hubResizeObserver: ResizeObserver | null = null;

  // Teleported panel bounds: stay inside the owning Agent Hub window when the
  // trigger lives inside one, otherwise fall back to the viewport.
  const HUB_SELECTOR = '.agent-hub-window';
  const EDGE_INSET = 12;

  const getHubElement = (): HTMLElement | null => {
    const hub = triggerRef.value?.closest(HUB_SELECTOR);
    return hub instanceof HTMLElement ? hub : null;
  };

  const resolveBounds = () => {
    const hub = getHubElement();
    if (hub) {
      const rect = hub.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  };

  const observeHub = () => {
    if (typeof ResizeObserver === 'undefined') return;
    hubResizeObserver?.disconnect();
    const hub = getHubElement();
    if (!hub) return;
    hubResizeObserver = new ResizeObserver(() => positionPanel());
    hubResizeObserver.observe(hub);
  };

  const enabledApps = computed(() => props.apps.filter((app) => app.enabled));
  const candidateApps = computed(() => enabledApps.value);

  const filteredApps = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (!needle) return candidateApps.value;
    return candidateApps.value.filter((app) => `${app.displayName} ${app.id}`.toLowerCase().includes(needle));
  });

  const positionPanel = (): boolean => {
    const anchor = triggerRef.value?.getBoundingClientRect();
    const popup = panelRef.value;
    if (!anchor || !popup) return false;
    const bounds = resolveBounds();
    const availableWidth = Math.max(0, bounds.right - bounds.left - EDGE_INSET * 2);
    const availableHeight = Math.max(0, bounds.bottom - bounds.top - EDGE_INSET * 2);
    popup.style.maxWidth = `${availableWidth}px`;
    popup.style.maxHeight = `${availableHeight}px`;
    const popupRect = popup.getBoundingClientRect();
    const width = Math.min(popupRect.width || 260, availableWidth);
    const height = Math.min(popupRect.height || 220, availableHeight);

    let left = anchor.left;
    if (left + width > bounds.right - EDGE_INSET) {
      left = Math.max(bounds.left + EDGE_INSET, anchor.right - width);
    }
    left = Math.max(bounds.left + EDGE_INSET, Math.min(left, bounds.right - EDGE_INSET - width));

    let top = anchor.bottom + 6;
    if (top + height > bounds.bottom - EDGE_INSET) {
      top = Math.max(bounds.top + EDGE_INSET, anchor.top - height - 6);
    }
    top = Math.max(bounds.top + EDGE_INSET, Math.min(top, bounds.bottom - EDGE_INSET - height));

    position.value = {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      maxWidth: `${availableWidth}px`,
      maxHeight: `${availableHeight}px`,
    };
    positioned.value = true;
    return true;
  };

  const toggle = async () => {
    if (open.value) {
      close();
      return;
    }
    open.value = true;
    query.value = '';
    await nextTick();
    if (!positionPanel()) requestAnimationFrame(() => positionPanel());
    observeHub();
    panelRef.value?.focus();
  };

  const close = (restoreFocus = false) => {
    if (!open.value) return;
    open.value = false;
    positioned.value = false;
    hubResizeObserver?.disconnect();
    if (restoreFocus) queueMicrotask(() => triggerRef.value?.focus());
  };

  const selectApp = (appId: string) => {
    emit('switch', appId);
    close();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!open.value || !(event.target instanceof Node)) return;
    if (triggerRef.value?.contains(event.target) || panelRef.value?.contains(event.target)) return;
    close();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open.value || event.key !== 'Escape') return;
    event.preventDefault();
    close(true);
  };

  onMounted(() => {
    window.addEventListener('resize', positionPanel);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  });

  onBeforeUnmount(() => {
    hubResizeObserver?.disconnect();
    window.removeEventListener('resize', positionPanel);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  });
</script>

<template>
  <div class="relative inline-flex shrink-0 items-center">
    <button
      ref="triggerRef"
      type="button"
      class="agent-app-new-tab flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-transparent text-text-secondary/70 transition-colors hover:bg-card/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 active:scale-95"
      :class="open ? 'bg-card/70 text-foreground' : ''"
      :aria-label="$t('agent.hub.chooseApp')"
      :title="$t('agent.hub.chooseApp')"
      :aria-expanded="open"
      @click="toggle"
    >
      <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        data-agent-hub-portal
        ref="panelRef"
        tabindex="-1"
        :style="[position, positioned ? null : { visibility: 'hidden' }]"
        class="fixed z-[60] flex w-72 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl outline-none backdrop-blur-md"
      >
        <div class="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs font-semibold">
          <div class="flex items-center gap-1.5">
            <span class="text-foreground">{{ $t('agent.hub.apps') }}</span>
            <span
              class="rounded border border-border/60 bg-header px-1.5 py-0.5 text-[11px] font-medium text-text-secondary"
            >
              {{ candidateApps.length }}
            </span>
          </div>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-header hover:text-foreground"
            :aria-label="$t('agent.hub.close')"
            :title="$t('agent.hub.close')"
            @click.stop="close()"
          >
            <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
          </button>
        </div>

        <div v-if="candidateApps.length > 4" class="border-b border-border/50 p-2">
          <div class="relative">
            <i
              class="fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
              aria-hidden="true"
            ></i>
            <input
              v-model="query"
              type="search"
              class="h-7 w-full rounded-lg border border-border/60 bg-background/80 pl-7 pr-2 text-xs outline-none focus:border-border-hover focus:ring-1 focus:ring-border/40"
              :placeholder="$t('agent.hub.searchApps')"
              autofocus
            />
          </div>
        </div>

        <div class="max-h-64 overflow-y-auto p-1.5 space-y-1">
          <button
            v-for="app in filteredApps"
            :key="app.id"
            type="button"
            class="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-header"
            :class="
              app.id === activeAppId
                ? 'border border-border/80 bg-card font-medium text-foreground shadow-xs'
                : 'border border-transparent text-text-secondary hover:text-foreground'
            "
            @click="selectApp(app.id)"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="
                  app.health === 'healthy'
                    ? 'bg-success'
                    : app.health === 'degraded'
                      ? 'bg-warning'
                      : 'bg-text-secondary/50'
                "
              ></span>
              <div class="min-w-0">
                <div class="truncate text-xs font-medium leading-none">{{ app.displayName }}</div>
                <div class="mt-1 truncate text-[11px] text-text-secondary">
                  {{ app.id }}
                </div>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <span
                v-if="app.runningRuns"
                class="rounded-md border border-border/60 bg-header px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                :title="$t('agent.hub.runningRuns')"
              >
                <i class="fa-solid fa-play mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.runningRuns }}
              </span>
              <span
                v-if="app.pendingApprovals"
                class="rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning"
                :title="$t('agent.hub.pendingApprovals')"
              >
                <i class="fa-solid fa-shield-halved mr-0.5 text-[6px]" aria-hidden="true"></i>{{ app.pendingApprovals }}
              </span>
              <i v-if="app.id === activeAppId" class="fa-solid fa-check text-xs text-foreground" aria-hidden="true"></i>
            </div>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
