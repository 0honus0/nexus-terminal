<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseBadge, BaseButton, BaseContextMenu } from '@/foundation/ui';
  import { useLongPressGesture } from '@/foundation/interaction';
  import type { WorkspaceRuntimeSession } from '../session';

  const { t } = useI18n();
  const props = withDefaults(
    defineProps<{ sessions: WorkspaceRuntimeSession[]; activeId: string | null; mobile?: boolean }>(),
    { mobile: false },
  );
  const emit = defineEmits<{
    activate: [id: string];
    close: [id: string];
    closeOthers: [id: string];
    closeRight: [id: string];
    closeLeft: [id: string];
    toggleSuspend: [id: string];
    reorder: [id: string, targetId: string, placement: 'before' | 'after'];
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

  const tone = (state: WorkspaceRuntimeSession['state']['value']) =>
    state === 'connected'
      ? 'success'
      : state === 'error'
        ? 'danger'
        : state === 'reconnecting' || state === 'connecting'
          ? 'warning'
          : 'neutral';

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
    element.scrollLeft += event.deltaY;
    event.preventDefault();
  };
  const startDrag = (event: DragEvent, id: string): void => {
    if (props.mobile) return;
    draggingId.value = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
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
    if (props.mobile) {
      draggingId.value = null;
      dropTarget.value = null;
      return;
    }
    const placement = dropTarget.value?.id === targetId ? dropTarget.value.placement : 'before';
    draggingId.value = null;
    dropTarget.value = null;
    if (id && id !== targetId) emit('reorder', id, targetId, placement);
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
</script>

<template>
  <div
    class="flex min-h-10 items-stretch overflow-x-auto border-b border-border bg-header/60"
    data-testid="terminal-tab-bar"
    role="tablist"
    @wheel="handleWheel"
  >
    <div
      v-for="session in props.sessions"
      :key="session.id"
      :data-session-id="session.id"
      class="flex min-w-40 max-w-72 items-stretch border-r border-border"
      :class="[
        session.id === activeId ? 'bg-background' : 'text-text-secondary',
        {
          'opacity-60': draggingId === session.id,
          'border-l-2 border-l-primary': dropTarget?.id === session.id && dropTarget.placement === 'before',
          'border-r-2 border-r-primary': dropTarget?.id === session.id && dropTarget.placement === 'after',
        },
      ]"
      role="tab"
      :draggable="!props.mobile"
      :aria-selected="session.id === activeId"
      :aria-grabbed="draggingId === session.id"
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
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
        @click="activate($event, session.id)"
      >
        <span class="min-w-0 flex-1 truncate">{{ session.connection.name || session.connection.host }}</span>
        <BaseBadge :tone="tone(session.state.value)">{{
          t(`workspace.sessionState.${session.state.value}`)
        }}</BaseBadge>
      </button>
      <BaseButton
        v-if="
          session.connection.type === 'SSH' && (session.state.value === 'connected' || session.markedForSuspend.value)
        "
        size="sm"
        :variant="session.markedForSuspend.value ? 'primary' : 'ghost'"
        :title="
          t(session.markedForSuspend.value ? 'tabs.contextMenu.unmarkForSuspend' : 'tabs.contextMenu.suspendSession')
        "
        :aria-pressed="session.markedForSuspend.value"
        @click.stop="emit('toggleSuspend', session.id)"
        >{{ session.markedForSuspend.value ? '↩' : '⏸' }}</BaseButton
      >
      <BaseButton
        size="sm"
        variant="ghost"
        :title="t('tabs.closeTabTooltip')"
        :aria-label="t('tabs.closeTabTooltip')"
        @click.stop="emit('close', session.id)"
        >×</BaseButton
      >
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
    display: block;
    width: 100%;
    border-radius: 0.25rem;
    padding: 0.45rem 0.6rem;
    text-align: left;
  }
  .context-item:hover,
  .context-item:focus-visible {
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
    outline: none;
  }
</style>
