<script setup lang="ts">
  import type { AgentApprovalView, AgentServerClockAnchor } from '../api/agent-api';
  import ApprovalCard from './ApprovalCard.vue';

  defineProps<{ approvals: AgentApprovalView[]; clock: AgentServerClockAnchor | null; busy?: boolean }>();
  const emit = defineEmits<{ resolve: [approval: AgentApprovalView, decision: 'approved' | 'denied'] }>();
</script>

<template>
  <section v-if="approvals.length" class="space-y-2">
    <strong class="text-xs">{{ $t('agent.approvals.timeline') }}</strong>
    <ApprovalCard
      v-for="approval in approvals"
      :key="approval.id"
      v-if="clock"
      :approval="approval"
      :clock="clock"
      :busy="busy"
      @resolve="(item, decision) => emit('resolve', item, decision)"
    />
  </section>
</template>
