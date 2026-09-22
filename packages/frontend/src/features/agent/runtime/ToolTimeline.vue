<script setup lang="ts">
  import type { AgentApprovalView, AgentServerClockAnchor } from '../api/agent-api';
  import ApprovalCard from './ApprovalCard.vue';

  defineProps<{ approvals: AgentApprovalView[]; clock: AgentServerClockAnchor | null; busy?: boolean }>();
  const emit = defineEmits<{
    resolve: [approval: AgentApprovalView, decision: 'approved' | 'denied', feedback?: string];
  }>();
</script>

<template>
  <section v-if="approvals.length" class="space-y-2">
    <strong class="text-xs">{{ $t('agent.approvals.timeline') }}</strong>
    <template v-if="clock">
      <ApprovalCard
        v-for="approval in approvals"
        :key="approval.id"
        :approval="approval"
        :clock="clock"
        :busy="busy"
        @resolve="(item, decision, feedback) => emit('resolve', item, decision, feedback)"
      />
    </template>
  </section>
</template>
