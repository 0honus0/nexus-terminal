<script setup lang="ts">
  import { computed, onBeforeUnmount, ref } from 'vue';
  import type { AgentApprovalViewDto, AgentServerClockAnchor } from '../api/agent-api';

  const props = defineProps<{ approval: AgentApprovalViewDto; clock: AgentServerClockAnchor; busy?: boolean }>();
  const emit = defineEmits<{
    resolve: [approval: AgentApprovalViewDto, decision: 'approved' | 'denied', feedback?: string];
  }>();
  const feedbackVisible = ref(false);
  const feedback = ref('');
  const monotonicNow = ref(performance.now());
  const timer = window.setInterval(() => (monotonicNow.value = performance.now()), 1000);
  onBeforeUnmount(() => window.clearInterval(timer));

  const serverNowMilliseconds = computed(
    () =>
      props.clock.serverUnixMilliseconds + Math.max(0, monotonicNow.value - props.clock.clientMonotonicMilliseconds),
  );
  const remaining = computed(() =>
    Math.max(0, Math.ceil((props.approval.expiresAt * 1000 - serverNowMilliseconds.value) / 1000)),
  );
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
        <div class="font-semibold">
          {{ approval.kind === 'acp_permission' ? $t('agent.approvals.acpInnerTitle') : $t('agent.approvals.title') }}
        </div>
        <div class="mt-1 truncate font-mono text-[11px]">{{ approval.inspection.toolName }}</div>
      </div>
      <span class="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium">
        {{ approval.inspection.risk }}
      </span>
    </div>

    <dl class="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
      <dt class="text-text-secondary">{{ $t('agent.approvals.target') }}</dt>
      <dd class="break-words">{{ target.endpoint }} · {{ target.loginUser }}</dd>
      <dt class="text-text-secondary">{{ $t('agent.approvals.expires') }}</dt>
      <dd>{{ remaining }}s</dd>
    </dl>

    <details class="mt-3 rounded border border-border bg-background p-2">
      <summary class="cursor-pointer font-medium">{{ $t('agent.approvals.operation') }}</summary>
      <p class="mt-2 break-all font-mono text-[10px]">{{ $t('agent.approvals.hash') }}: {{ approval.operationHash }}</p>
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
    <div v-else class="mt-3 space-y-2">
      <div v-if="feedbackVisible" class="rounded-lg border border-border/70 bg-background/70 p-2">
        <label class="mb-1.5 block text-[10px] font-medium text-text-secondary">
          {{ $t('agent.approvals.feedbackLabel') }}
        </label>
        <textarea
          v-model="feedback"
          rows="2"
          maxlength="2000"
          class="w-full resize-none rounded-md border border-border/70 bg-card px-2.5 py-2 text-[11px] text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/15"
          :placeholder="$t('agent.approvals.feedbackPlaceholder')"
        ></textarea>
        <div class="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            class="rounded-md px-2.5 py-1.5 text-[10px] text-text-secondary hover:bg-header disabled:opacity-50"
            :disabled="!actionable"
            @click="feedbackVisible = false"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-error px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-50"
            :disabled="!actionable || !feedback.trim()"
            @click="emit('resolve', approval, 'denied', feedback.trim())"
          >
            {{ $t('agent.approvals.denyWithFeedbackSubmit') }}
          </button>
        </div>
      </div>
      <div class="grid gap-2" :class="approval.kind === 'acp_permission' ? 'grid-cols-2' : 'grid-cols-3'">
        <button
          type="button"
          class="rounded-md border border-error/40 px-2 py-2 font-medium text-error hover:bg-error/10 disabled:opacity-50"
          :disabled="!actionable"
          @click="emit('resolve', approval, 'denied')"
        >
          {{ approval.kind === 'acp_permission' ? $t('agent.approvals.rejectOnce') : $t('agent.approvals.deny') }}
        </button>
        <button
          v-if="approval.kind !== 'acp_permission'"
          type="button"
          class="rounded-md border border-border px-2 py-2 font-medium text-text-secondary hover:bg-header hover:text-foreground disabled:opacity-50"
          :disabled="!actionable"
          @click="feedbackVisible = !feedbackVisible"
        >
          {{ $t('agent.approvals.denyWithFeedback') }}
        </button>
        <button
          type="button"
          class="rounded-md bg-warning px-2 py-2 font-semibold text-black disabled:opacity-50"
          :disabled="!actionable"
          @click="emit('resolve', approval, 'approved')"
        >
          {{ approval.kind === 'acp_permission' ? $t('agent.approvals.allowOnce') : $t('agent.approvals.approve') }}
        </button>
      </div>
    </div>
  </article>
</template>
