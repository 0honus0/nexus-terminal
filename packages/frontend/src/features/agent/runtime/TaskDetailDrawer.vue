<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type {
    AgentApprovalView,
    AgentCheckpointView,
    AgentRunSnapshot,
    AgentServerClockAnchor,
    AgentSubagentMessage,
    AgentSubagentView,
  } from '../api/agent-api';
  import WorkspaceRuntimePanel from './WorkspaceRuntimePanel.vue';
  import SubagentTree from './SubagentTree.vue';
  import ToolTimeline from './ToolTimeline.vue';

  const props = defineProps<{
    snapshot: AgentRunSnapshot | null;
    checkpoints: AgentCheckpointView[];
    approvals: AgentApprovalView[];
    approvalClock: AgentServerClockAnchor | null;
    subagents: AgentSubagentView[];
    selectedSubagentId: string | null;
    subagentMessages: AgentSubagentMessage[];
    visible: boolean;
    busy: boolean;
  }>();
  defineEmits<{
    close: [];
    saveCheckpoint: [snapshot: AgentRunSnapshot];
    resumeCheckpoint: [snapshot: AgentRunSnapshot, checkpoint: AgentCheckpointView];
    selectSubagent: [delegation: AgentSubagentView];
    cancelSubagent: [delegation: AgentSubagentView];
    resolveApproval: [approval: AgentApprovalView, decision: 'approved' | 'denied'];
    deleteRun: [snapshot: AgentRunSnapshot];
  }>();

  const deleteArmed = ref(false);
  watch(
    () => [props.visible, props.snapshot?.id] as const,
    () => {
      deleteArmed.value = false;
    },
  );

  const terminal = new Set(['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted']);
  const canSave = () =>
    Boolean(props.snapshot && props.snapshot.status !== 'cancelling' && !props.snapshot.needsReconciliation);
</script>

<template>
  <aside
    v-if="visible"
    class="absolute inset-y-0 right-0 z-20 flex w-[min(520px,94%)] flex-col border-l border-border bg-card shadow-2xl"
    :aria-label="$t('agent.tasks.detail')"
  >
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-border/80 px-4">
      <div class="flex min-w-0 items-center gap-2.5">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-[11px] text-primary"
        >
          <i class="fa-solid fa-bars-progress" aria-hidden="true"></i>
        </div>
        <div class="min-w-0">
          <strong class="block text-sm leading-none">{{ $t('agent.tasks.detail') }}</strong>
          <span v-if="snapshot" class="mt-1 block truncate font-mono text-[8px] text-text-secondary">{{
            snapshot.id
          }}</span>
        </div>
      </div>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground"
        :aria-label="$t('agent.tasks.closeDetail')"
        @click="$emit('close')"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
      <template v-if="snapshot">
        <section class="rounded-xl border border-border bg-background p-3 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                {{ $t('agent.tasks.runOverview') }}
              </div>
              <div class="mt-1.5 flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-primary"></span>
                <strong class="text-sm">{{ $t(`agent.tasks.runStatus.${snapshot.status}`) }}</strong>
              </div>
            </div>
            <span class="rounded-full bg-header px-2 py-1 text-[9px] text-text-secondary">
              {{ $t(`agent.tasks.verificationStatus.${snapshot.verificationStatus}`) }}
            </span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="rounded-lg bg-card px-2.5 py-2">
              <div class="text-[8px] text-text-secondary">{{ $t('agent.tasks.goal') }}</div>
              <div class="mt-1 truncate text-[10px] font-medium">{{ snapshot.goalStatus }}</div>
            </div>
            <div class="rounded-lg bg-card px-2.5 py-2">
              <div class="text-[8px] text-text-secondary">{{ $t('agent.tasks.steps') }}</div>
              <div class="mt-1 text-[10px] font-medium">{{ snapshot.usage.steps }}</div>
            </div>
            <div class="rounded-lg bg-card px-2.5 py-2">
              <div class="text-[8px] text-text-secondary">{{ $t('agent.tasks.tokens') }}</div>
              <div class="mt-1 text-[10px] font-medium">
                {{ snapshot.usage.inputTokens + snapshot.usage.outputTokens }}
              </div>
            </div>
            <div class="rounded-lg bg-card px-2.5 py-2">
              <div class="text-[8px] text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
              <div class="mt-1 text-[10px] font-medium">{{ snapshot.activeExecutionSeconds }}s</div>
            </div>
          </div>
          <div
            v-if="terminal.has(snapshot.status)"
            class="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3"
          >
            <p class="max-w-72 text-[9px] leading-4 text-text-secondary">{{ $t('agent.tasks.deleteRunHint') }}</p>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                v-if="deleteArmed"
                type="button"
                class="rounded-lg border border-border px-2.5 py-1.5 text-[9px] font-medium text-text-secondary hover:bg-header"
                :disabled="busy"
                @click="deleteArmed = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-error/40 px-2.5 py-1.5 text-[9px] font-semibold text-error hover:bg-error/10 disabled:opacity-50"
                :disabled="busy"
                @click="deleteArmed ? $emit('deleteRun', snapshot) : (deleteArmed = true)"
              >
                {{ deleteArmed ? $t('agent.tasks.confirmDeleteRun') : $t('agent.tasks.deleteRun') }}
              </button>
            </div>
          </div>
        </section>

        <ToolTimeline
          v-if="approvals.length"
          class="mt-4 rounded-xl border border-border bg-background p-3"
          :approvals="approvals"
          :clock="approvalClock"
          :busy="busy"
          @resolve="(approval, decision) => $emit('resolveApproval', approval, decision)"
        />

        <section class="mt-4 rounded-xl border border-border bg-background p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h3 class="flex items-center gap-1.5 font-medium">
                <i class="fa-solid fa-bookmark text-[9px] text-text-secondary" aria-hidden="true"></i>
                {{ $t('agent.tasks.checkpoints') }}
              </h3>
              <p class="mt-1 text-[9px] leading-4 text-text-secondary">{{ $t('agent.tasks.checkpointHint') }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-medium hover:bg-header disabled:opacity-50"
              :disabled="busy || !canSave()"
              @click="$emit('saveCheckpoint', snapshot)"
            >
              <i class="fa-solid fa-plus mr-1 text-[8px]" aria-hidden="true"></i>
              {{ $t('agent.tasks.saveCheckpoint') }}
            </button>
          </div>
          <div v-if="checkpoints.length === 0" class="mt-3 rounded-lg bg-card px-3 py-3 text-[9px] text-text-secondary">
            {{ $t('agent.tasks.noCheckpoints') }}
          </div>
          <article
            v-for="checkpoint in checkpoints"
            :key="checkpoint.id"
            class="mt-2 rounded-lg border border-border/70 bg-card p-2.5"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-[9px]">{{ checkpoint.id }}</div>
                <div class="mt-1 text-[8px] text-text-secondary">
                  {{
                    $t('agent.tasks.checkpointWatermark', {
                      ledger: checkpoint.ledgerThrough,
                      event: checkpoint.eventThrough,
                    })
                  }}
                </div>
              </div>
              <button
                v-if="terminal.has(snapshot.status)"
                type="button"
                class="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[9px] font-semibold text-white disabled:opacity-50"
                :disabled="busy || snapshot.needsReconciliation"
                @click="$emit('resumeCheckpoint', snapshot, checkpoint)"
              >
                {{ $t('agent.tasks.resumeCheckpoint') }}
              </button>
            </div>
          </article>
        </section>

        <WorkspaceRuntimePanel :app-id="snapshot.appId" :run-id="snapshot.id" :busy="busy" />

        <SubagentTree
          :items="subagents"
          :selected-id="selectedSubagentId"
          :messages="subagentMessages"
          :busy="busy"
          @select="$emit('selectSubagent', $event)"
          @cancel="$emit('cancelSubagent', $event)"
        />

        <details class="mt-4 rounded-xl border border-border bg-background p-3">
          <summary class="cursor-pointer text-[10px] font-medium">
            <i class="fa-solid fa-wave-square mr-1.5 text-[9px] text-text-secondary" aria-hidden="true"></i>
            {{ $t('agent.tasks.recentFacts') }} · {{ snapshot.recentEntries.length }}
          </summary>
          <article v-for="entry in snapshot.recentEntries" :key="entry.id" class="mt-2 rounded-lg bg-card p-2.5">
            <div class="text-[8px] text-text-secondary">#{{ entry.sequence }} · {{ entry.kind }}</div>
            <pre class="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[9px] leading-4">{{
              JSON.stringify(entry.payload, null, 2)
            }}</pre>
          </article>
        </details>
      </template>
    </div>
  </aside>
</template>
