<script setup lang="ts">
  import { defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
  import { loadTerminalView } from '@/features/terminal/public';
  import {
    createAgentWorkspaceTerminalChannel,
    type AgentWorkspaceTerminalChannel,
  } from './agent-workspace-terminal-channel';

  const props = defineProps<{
    appId: string;
    workspaceId: string;
    generation: number;
    running: boolean;
  }>();

  const TerminalView = defineAsyncComponent(loadTerminalView);
  const channel = ref<AgentWorkspaceTerminalChannel | null>(null);
  const error = ref('');
  const opened = ref(false);

  const close = (): void => {
    channel.value?.close();
    channel.value = null;
    opened.value = false;
  };
  const open = (): void => {
    if (!props.running || channel.value) return;
    error.value = '';
    channel.value = createAgentWorkspaceTerminalChannel({
      appId: props.appId,
      workspaceId: props.workspaceId,
      generation: props.generation,
    });
    opened.value = true;
  };

  watch(
    () => [props.workspaceId, props.generation, props.running] as const,
    ([workspaceId, generation, running], previous) => {
      if (!previous) return;
      if (!running || workspaceId !== previous[0] || generation !== previous[1]) close();
    },
  );
  onBeforeUnmount(close);
</script>

<template>
  <div class="mt-2 rounded border border-border bg-background p-2">
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.localTerminal') }}</div>
        <div class="text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.localTerminalHint') }}</div>
      </div>
      <button
        v-if="!opened"
        type="button"
        class="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-50"
        :disabled="!running"
        @click="open"
      >
        {{ $t('agent.workspaceRuntime.openTerminal') }}
      </button>
      <button v-else type="button" class="rounded border border-border px-2 py-1 text-[10px]" @click="close">
        {{ $t('agent.workspaceRuntime.closeTerminal') }}
      </button>
    </div>
    <p v-if="error" class="mt-1 text-[9px] text-error">{{ error }}</p>
    <div v-if="channel" class="mt-2 h-72 min-h-0 overflow-hidden rounded border border-border bg-black">
      <TerminalView
        :channel="channel"
        :font-size="12"
        :scrollback="5000"
        @error="error = $event"
        @closed="error = $event || ''"
      />
    </div>
  </div>
</template>
