<script setup lang="ts">
  import { computed, onBeforeUnmount, ref } from 'vue';
  import type { AgentApprovalView } from '../api/agent-api';

  const props = defineProps<{ approval: AgentApprovalView; busy?: boolean }>();
  const emit = defineEmits<{ resolve: [approval: AgentApprovalView, decision: 'approved' | 'denied'] }>();
  const now = ref(Math.floor(Date.now() / 1000));
  const timer = window.setInterval(() => (now.value = Math.floor(Date.now() / 1000)), 1000);
  onBeforeUnmount(() => window.clearInterval(timer));

  const remaining = computed(() => Math.max(0, props.approval.expiresAt - now.value));
  const actionable = computed(
    () => props.approval.status === 'requested' && remaining.value > 0 && props.busy !== true,
  );
  const argumentsText = computed(() => {
    try {
      return JSON.stringify(props.approval.inspection.normalizedArguments, null, 2);
    } catch {
      return String(props.approval.inspection.normalizedArguments);
    }
  });
  const target = computed(() => props.approval.inspection.target);
</script>

<template>
  <article class="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="font-semibold">{{ $t('agent.approvals.title') }}</div>
        <div class="mt-1 truncate font-mono text-[11px]">{{ approval.inspection.toolName }}</div>
      </div>
      <span class="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium">
        {{ approval.inspection.risk }}
      </span>
    </div>

    <dl class="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
      <dt class="text-text-secondary">{{ $t('agent.approvals.target') }}</dt>
      <dd class="truncate">{{ target.endpoint }} · {{ target.loginUser }}</dd>
      <dt class="text-text-secondary">{{ $t('agent.approvals.expires') }}</dt>
      <dd>{{ remaining }}s</dd>
      <dt class="text-text-secondary">{{ $t('agent.approvals.hash') }}</dt>
      <dd class="break-all font-mono text-[9px]">{{ approval.operationHash }}</dd>
    </dl>

    <details class="mt-3 rounded border border-border bg-background p-2">
      <summary class="cursor-pointer font-medium">{{ $t('agent.approvals.operation') }}</summary>
      <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px]">{{ argumentsText }}</pre>
      <div v-if="approval.inspection.preconditions.length" class="mt-2 border-t border-border pt-2">
        <div class="mb-1 text-[10px] font-medium text-text-secondary">{{ $t('agent.approvals.preconditions') }}</div>
        <div
          v-for="precondition in approval.inspection.preconditions"
          :key="`${precondition.kind}:${precondition.key}`"
          class="mb-1 break-all font-mono text-[9px]"
        >
          {{ precondition.kind }} · {{ precondition.key }}
        </div>
      </div>
    </details>

    <p v-if="approval.status !== 'requested'" class="mt-3 text-[11px] text-text-secondary">
      {{ $t('agent.approvals.resolved', { state: approval.status }) }}
    </p>
    <p v-else-if="remaining === 0" class="mt-3 text-[11px] text-error">{{ $t('agent.approvals.expired') }}</p>
    <div v-else class="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        class="rounded-md border border-error/40 px-3 py-2 font-medium text-error hover:bg-error/10 disabled:opacity-50"
        :disabled="!actionable"
        @click="emit('resolve', approval, 'denied')"
      >
        {{ $t('agent.approvals.deny') }}
      </button>
      <button
        type="button"
        class="rounded-md bg-warning px-3 py-2 font-semibold text-black disabled:opacity-50"
        :disabled="!actionable"
        @click="emit('resolve', approval, 'approved')"
      >
        {{ $t('agent.approvals.approve') }}
      </button>
    </div>
  </article>
</template>
