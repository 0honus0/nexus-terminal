<script setup lang="ts">
  import type { AgentSubagentMessage } from '../api/agent-api';

  defineProps<{
    messages: AgentSubagentMessage[];
  }>();
</script>

<template>
  <section class="rounded border border-border p-3">
    <h4 class="text-xs font-medium">{{ $t('agent.subagents.messages') }}</h4>
    <p v-if="messages.length === 0" class="mt-2 text-[10px] text-text-secondary">
      {{ $t('agent.subagents.noMessages') }}
    </p>
    <div v-else class="mt-2 space-y-2">
      <article v-for="message in messages" :key="message.id" class="rounded bg-background p-2">
        <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-secondary">
          <span>#{{ message.recipientSequence }} · {{ message.kind }} · {{ message.status }}</span>
          <span>{{ new Date(message.createdAt * 1000).toLocaleString() }}</span>
        </div>
        <div class="mt-1 break-all font-mono text-[9px] text-text-secondary">
          {{ message.senderRuntimeId }} → {{ message.recipientRuntimeId }}
        </div>
        <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px]">{{
          JSON.stringify(message.body, null, 2)
        }}</pre>
        <div v-if="message.artifactRefs.length" class="mt-1 text-[10px] text-text-secondary">
          {{ $t('agent.subagents.artifacts', { count: message.artifactRefs.length }) }}
        </div>
      </article>
    </div>
  </section>
</template>
