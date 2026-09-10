<script setup lang="ts">
  import type { AgentSubagentMessage, AgentSubagentView } from '../api/agent-api';
  import MessageExchangePanel from './MessageExchangePanel.vue';
  import SubagentCard from './SubagentCard.vue';

  defineProps<{
    items: AgentSubagentView[];
    selectedId: string | null;
    messages: AgentSubagentMessage[];
    busy: boolean;
  }>();

  defineEmits<{
    select: [delegation: AgentSubagentView];
    cancel: [delegation: AgentSubagentView];
  }>();
</script>

<template>
  <section class="mt-4 rounded border border-border p-3">
    <div class="flex items-center justify-between gap-2">
      <div>
        <h3 class="font-medium">{{ $t('agent.subagents.title') }}</h3>
        <p class="mt-0.5 text-[10px] text-text-secondary">{{ $t('agent.subagents.description') }}</p>
      </div>
      <span class="rounded bg-header px-2 py-1 text-[10px]">{{ items.length }}</span>
    </div>
    <p v-if="items.length === 0" class="mt-3 text-[10px] text-text-secondary">
      {{ $t('agent.subagents.empty') }}
    </p>
    <div v-else class="mt-3 space-y-2">
      <div
        v-for="delegation in items"
        :key="delegation.id"
        :style="{ paddingLeft: `${Math.max(0, delegation.depth - 1) * 12}px` }"
      >
        <SubagentCard
          :delegation="delegation"
          :selected="selectedId === delegation.id"
          :busy="busy"
          @select="$emit('select', $event)"
          @cancel="$emit('cancel', $event)"
        />
      </div>
    </div>
    <MessageExchangePanel v-if="selectedId" class="mt-3" :messages="messages" />
  </section>
</template>
