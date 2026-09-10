<script setup lang="ts">
  import type { AgentApprovalView } from '../api/agent-api';
  import ApprovalCard from './ApprovalCard.vue';

  defineProps<{ approvals: AgentApprovalView[]; busy?: boolean }>();
  const emit = defineEmits<{ resolve: [approval: AgentApprovalView, decision: 'approved' | 'denied'] }>();
</script>

<template>
  <section v-if="approvals.length" class="space-y-2">
    <strong class="text-xs">{{ $t('agent.approvals.timeline') }}</strong>
    <ApprovalCard
      v-for="approval in approvals"
      :key="approval.id"
      :approval="approval"
      :busy="busy"
      @resolve="(item, decision) => emit('resolve', item, decision)"
    />
  </section>
</template>
