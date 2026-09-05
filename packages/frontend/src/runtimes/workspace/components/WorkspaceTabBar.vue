<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu } from '@/foundation/ui';
  import { useLongPressGesture } from '@/foundation/interaction';
  import type { WorkspaceRuntimeSession } from '../session';

  const { t } = useI18n();
  const props = withDefaults(
    defineProps<{
      sessions: WorkspaceRuntimeSession[];
      activeId: string | null;
      mobile?: boolean;
      navBarVisible?: boolean;
      progressTaskCount?: number;
    }>(),
    { mobile: false, navBarVisible: true, progressTaskCount: 0 },
  );
  const emit = defineEmits<{
    activate: [id: string];
    close: [id: string];
    closeOthers: [id: string];
    closeRight: [id: string];
    closeLeft: [id: string];
    toggleSuspend: [id: string];
    reorder: [id: string, targetId: string, placement: 'before' | 'after'];
    newSession: [];
    toggleHeader: [];
    openProgress: [];
    openSuspended: [];
    openFocusConfigurator: [];
    openLayoutConfigurator: [];
  }>();

  const context = ref<{ session: WorkspaceRuntimeSession; x: number; y: number } | null>(null);
  const draggingId = ref<string | null>(null);
  const dropTarget = ref<{ id: string; placement: 'before' | 'after' } | null>(null);
  const contextIndex = computed(() =>
    context.value ? props.sessions.findIndex((session) => session.id === context.value?.session.id) : -1,
  );
  const canCloseOthers = computed(() => props.sessions.length > 1);
  const canCloseRight = computed(() => contextIndex.value >= 0 && contextIndex.value < props.sessions.length - 1);
  const canCloseLeft = computed(() => contextIndex.value > 0);
  const contextCanToggleSuspend = computed(
    () => context.value?.session.connection.type === 'SSH' && context.value.session.state === 'connected',
  );
  const contextMarkedForSuspend = computed(() => Boolean(context.value?.session.markedForSuspend));

  const openContextAt = (session: WorkspaceRuntimeSession, x: number, y: number): void => {
    context.value = { session, x, y };
  };
  const longPress = useLongPressGesture<WorkspaceRuntimeSession>({
    vibrateMs: 15,
    onTrigger: (session, point) => openContextAt(session, point.x, point.y),
  });
  const openContext = (event: MouseEvent, session: WorkspaceRuntimeSession): void => {
    event.preventDefault();
    openContextAt(session, event.clientX, event.clientY);
  };
  const activate = (event: MouseEvent, id: string): void => {
    if (longPress.consumeClick(event)) return;
    emit('activate', id);
  };

  const handleWheel = (event: WheelEvent): void => {
    const element = event.currentTarget as HTMLElement;
    if (element.scrollWidth <= element.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    element.scrollLeft += event.deltaY > 0 ? 50 : -50;
    event.preventDefault();
  };
  const startDrag = (event: DragEvent, id: string): void => {
    if (props.mobile) return;
    draggingId.value = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
      const image = new Image();
      image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      event.dataTransfer.setDragImage(image, 0, 0);
    }
  };
  const updateDropTarget = (event: DragEvent, targetId: string): void => {
    if (props.mobile || !draggingId.value || draggingId.value === targetId) return;
    const element = event.currentTarget as HTMLElement;
    const placement =
      event.clientX < element.getBoundingClientRect().left + element.clientWidth / 2 ? 'before' : 'after';
    dropTarget.value = { id: targetId, placement };
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };
  const finishDrop = (targetId: string): void => {
    const id = draggingId.value;
    const placement = dropTarget.value?.id === targetId ? dropTarget.value.placement : 'before';
    draggingId.value = null;
    dropTarget.value = null;
    if (!props.mobile && id && id !== targetId) emit('reorder', id, targetId, placement);
  };
  const clearDrag = (): void => {
    draggingId.value = null;
    dropTarget.value = null;
  };

  const runContextAction = (action: 'close' | 'closeOthers' | 'closeRight' | 'closeLeft' | 'toggleSuspend'): void => {
    const id = context.value?.session.id;
    context.value = null;
    if (!id) return;
    if (action === 'close') emit('close', id);
    else if (action === 'closeOthers') emit('closeOthers', id);
    else if (action === 'closeRight') emit('closeRight', id);
    else if (action === 'closeLeft') emit('closeLeft', id);
    else emit('toggleSuspend', id);
  };

  const stateDotClass = (session: WorkspaceRuntimeSession): string => {
    if (session.markedForSuspend.value) return 'bg-blue-500';
    if (session.state.value === 'connected') return 'bg-green-500';
    if (session.state.value === 'connecting' || session.state.value === 'reconnecting')
      return 'bg-yellow-500 animate-pulse';
    if (session.state.value === 'error' || session.state.value === 'disconnected') return 'bg-red-500';
    return 'bg-gray-400';
  };
</script>

<template>
  <div class="terminal-tab-shell shrink-0">
    <div
      data-testid="terminal-tab-bar"
      role="tablist"
      :class="[
        'flex overflow-hidden border border-border bg-header',
        props.mobile ? 'h-8' : 'mx-2 mt-2 h-10 rounded-t-md',
      ]"
    >
      <div class="flex min-w-0 shrink items-center overflow-x-auto" @wheel="handleWheel">
        <ul class="m-0 flex h-full shrink-0 list-none p-0">
          <li
            v-for="session in props.sessions"
            :key="session.id"
            :data-testid="`terminal-tab-${session.id}`"
            :data-session-id="session.id"
            role="tab"
            :aria-selected="session.id === activeId"
            :aria-grabbed="draggingId === session.id"
            :draggable="!props.mobile"
            :title="session.connection.name || session.connection.host"
            :class="[
              'group relative flex h-full cursor-pointer items-center border-r border-border px-3 transition-colors duration-150',
              session.id === activeId
                ? 'bg-background text-foreground'
                : 'bg-header text-text-secondary hover:bg-border',
              {
                'opacity-60': draggingId === session.id,
                'border-l-2 border-l-primary': dropTarget?.id === session.id && dropTarget.placement === 'before',
                'border-r-2 border-r-primary': dropTarget?.id === session.id && dropTarget.placement === 'after',
              },
            ]"
            @click="activate($event, session.id)"
            @dragstart="startDrag($event, session.id)"
            @dragover.prevent="updateDropTarget($event, session.id)"
            @drop.prevent="finishDrop(session.id)"
            @dragend="clearDrag"
            @contextmenu="openContext($event, session)"
            @pointerdown="longPress.start($event, session)"
            @pointermove="longPress.move"
            @pointerup="longPress.end"
            @pointercancel="longPress.cancel"
          >
            <span class="mr-2 h-2 w-2 shrink-0 rounded-full" :class="stateDotClass(session)"></span>
            <span class="max-w-44 truncate text-sm" style="transform: translateY(-1px)">
              {{ session.connection.name || session.connection.host }}
            </span>
            <button
              type="button"
              class="ml-2 flex shrink-0 items-center justify-center rounded-full p-0.5 transition-all duration-150"
              :class="
                props.mobile
                  ? 'bg-border/30 text-foreground opacity-100'
                  : session.id === activeId
                    ? 'text-text-secondary opacity-0 group-hover:opacity-100 hover:bg-header hover:text-foreground'
                    : 'text-text-secondary opacity-0 group-hover:opacity-100 hover:bg-border hover:text-foreground'
              "
              :title="t('tabs.closeTabTooltip')"
              :aria-label="t('tabs.closeTabTooltip')"
              @click.stop="emit('close', session.id)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </li>
        </ul>

        <button
          type="button"
          class="flex h-full shrink-0 items-center justify-center px-3 text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          :title="t('tabs.newTabTooltip')"
          :aria-label="t('tabs.newTabTooltip')"
          @click="emit('newSession')"
        >
          <i class="fas fa-plus text-sm" aria-hidden="true"></i>
        </button>
      </div>

      <div class="ml-auto flex h-full shrink-0 items-center">
        <button
          type="button"
          class="flex h-full items-center justify-center border-l border-border px-3 text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          :title="t(props.navBarVisible ? 'header.hide' : 'header.show')"
          :aria-label="t(props.navBarVisible ? 'header.hide' : 'header.show')"
          @click="emit('toggleHeader')"
        >
          <i :class="['fas', props.navBarVisible ? 'fa-eye' : 'fa-eye-slash', 'text-sm']" aria-hidden="true"></i>
        </button>
        <button
          v-if="props.progressTaskCount > 0"
          data-testid="transfer-progress-toggle"
          type="button"
          class="relative flex h-full items-center justify-center border-l border-border px-3 text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          :title="t('terminalTabBar.progressDisplay')"
          :aria-label="t('terminalTabBar.progressDisplay')"
          @click="emit('openProgress')"
        >
          <i class="fas fa-tasks text-sm" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="flex h-full items-center justify-center border-l border-border px-3 text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          :title="t('suspendedSshSessions.modalTitle')"
          :aria-label="t('suspendedSshSessions.modalTitle')"
          @click="emit('openSuspended')"
        >
          <i class="fas fa-pause-circle text-sm" aria-hidden="true"></i>
        </button>
        <button
          v-if="!props.mobile"
          type="button"
          class="flex h-full items-center justify-center border-l border-border px-3 text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          :title="t('commandInputBar.configureFocusSwitch')"
          :aria-label="t('commandInputBar.configureFocusSwitch')"
          @click="emit('openFocusConfigurator')"
        >
          <i class="fas fa-keyboard text-sm" aria-hidden="true"></i>
        </button>
        <button
          v-if="!props.mobile"
          type="button"
          class="flex h-full items-center justify-center border-l border-border px-3 text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          :title="t('layout.configure')"
          :aria-label="t('layout.configure')"
          @click="emit('openLayoutConfigurator')"
        >
          <i class="fas fa-th-large text-sm" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>

  <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="220" @close="context = null">
    <button v-if="contextCanToggleSuspend" class="context-item" @click="runContextAction('toggleSuspend')">
      {{ t(contextMarkedForSuspend ? 'tabs.contextMenu.unmarkForSuspend' : 'tabs.contextMenu.suspendSession') }}
    </button>
    <div v-if="contextCanToggleSuspend" class="my-1 border-t border-border" role="separator"></div>
    <button class="context-item" @click="runContextAction('close')">{{ t('tabs.contextMenu.close') }}</button>
    <button v-if="canCloseOthers" class="context-item" @click="runContextAction('closeOthers')">
      {{ t('tabs.contextMenu.closeOthers') }}
    </button>
    <button v-if="canCloseRight" class="context-item" @click="runContextAction('closeRight')">
      {{ t('tabs.contextMenu.closeRight') }}
    </button>
    <button v-if="canCloseLeft" class="context-item" @click="runContextAction('closeLeft')">
      {{ t('tabs.contextMenu.closeLeft') }}
    </button>
  </BaseContextMenu>
</template>

<style scoped>
  .context-item {
    display: flex;
    width: calc(100% - 0.5rem);
    margin-inline: 0.25rem;
    align-items: center;
    border-radius: 0.375rem;
    padding: 0.4rem 0.65rem;
    text-align: left;
    font-size: 0.875rem;
  }
  .context-item:hover,
  .context-item:focus-visible {
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
    color: var(--primary-color);
    outline: none;
  }
</style>
