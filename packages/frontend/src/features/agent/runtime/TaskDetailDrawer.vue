<script setup lang="ts">
  import { ref, watch, nextTick } from 'vue';
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
  const emit = defineEmits<{
    close: [];
    saveCheckpoint: [snapshot: AgentRunSnapshot];
    resumeCheckpoint: [snapshot: AgentRunSnapshot, checkpoint: AgentCheckpointView];
    selectSubagent: [delegation: AgentSubagentView];
    cancelSubagent: [delegation: AgentSubagentView];
    resolveApproval: [approval: AgentApprovalView, decision: 'approved' | 'denied'];
    deleteRun: [snapshot: AgentRunSnapshot];
  }>();

  const drawer = ref<HTMLElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  watch(
    () => props.visible,
    async (visible) => {
      if (visible) {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await nextTick();
        drawer.value?.focus();
      } else previousFocus?.focus();
    },
  );
  const trapFocus = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      drawer.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
      ) ?? [],
    ).filter((el) => el.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.value)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawer.value)) {
      event.preventDefault();
      first.focus();
    }
  };

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
  <div
    v-if="visible"
    class="agent-detail-backdrop absolute inset-0 z-40 bg-background/35 backdrop-blur-[1px]"
    aria-hidden="true"
    @click="$emit('close')"
  ></div>
  <aside
    v-if="visible"
    ref="drawer"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    @keydown.esc.stop.prevent="emit('close')"
    @keydown="trapFocus"
    class="absolute inset-y-0 right-0 z-50 flex w-[min(540px,94%)] flex-col border-l border-border/60 bg-background shadow-2xl"
    :aria-label="$t('agent.tasks.detail')"
  >
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
      <div class="flex min-w-0 items-center gap-2.5">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs text-primary">
          <i class="fa-solid fa-bars-progress" aria-hidden="true"></i>
        </div>
        <div class="min-w-0">
          <strong class="block text-sm leading-none">{{ $t('agent.tasks.detail') }}</strong>
          <span v-if="snapshot" class="mt-1 block truncate font-mono text-xs text-text-secondary">{{
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

    <div class="min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">
      <template v-if="snapshot">
        <section class="rounded-2xl border border-border/60 bg-card/55 p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                {{ $t('agent.tasks.runOverview') }}
              </div>
              <div class="mt-1.5 flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-primary"></span>
                <strong class="text-sm">{{ $t(`agent.tasks.runStatus.${snapshot.status}`) }}</strong>
              </div>
            </div>
            <span class="rounded-full bg-header px-2.5 py-1 text-xs text-text-secondary">
              {{ $t(`agent.tasks.verificationStatus.${snapshot.verificationStatus}`) }}
            </span>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-3 sm:grid-cols-4">
            <div class="min-w-0">
              <div class="text-xs text-text-secondary">{{ $t('agent.tasks.goal') }}</div>
              <div class="mt-1 truncate text-xs font-medium">{{ snapshot.goalStatus }}</div>
            </div>
            <div class="min-w-0">
              <div class="text-xs text-text-secondary">{{ $t('agent.tasks.steps') }}</div>
              <div class="mt-1 text-xs font-medium">{{ snapshot.usage.steps }}</div>
            </div>
            <div class="min-w-0">
              <div class="text-xs text-text-secondary">{{ $t('agent.tasks.tokens') }}</div>
              <div class="mt-1 text-xs font-medium">
                {{ snapshot.usage.inputTokens + snapshot.usage.outputTokens }}
              </div>
            </div>
            <div class="min-w-0">
              <div class="text-xs text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
              <div class="mt-1 text-xs font-medium">{{ snapshot.activeExecutionSeconds }}s</div>
            </div>
          </div>
          <div
            class="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3 text-[10px] text-text-secondary"
          >
            <span class="rounded-lg bg-header px-2 py-1">
              <i class="fa-solid fa-microchip mr-1 text-[8px]" aria-hidden="true"></i
              >{{ snapshot.definition.model.modelId }}
            </span>
            <span v-if="snapshot.definition.reasoningEffort" class="rounded-lg bg-header px-2 py-1">
              <i class="fa-solid fa-brain mr-1 text-[8px]" aria-hidden="true"></i
              >{{ $t(`agent.ui.reasoningLevels.${snapshot.definition.reasoningEffort}`) }}
            </span>
          </div>
          <div
            v-if="terminal.has(snapshot.status)"
            class="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3"
          >
            <p class="max-w-72 text-xs leading-4 text-text-secondary">{{ $t('agent.tasks.deleteRunHint') }}</p>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                v-if="deleteArmed"
                type="button"
                class="rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-header"
                :disabled="busy"
                @click="deleteArmed = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-error/40 px-2.5 py-1.5 text-xs font-semibold text-error hover:bg-error/10 disabled:opacity-50"
                :disabled="busy"
                @click="deleteArmed ? $emit('deleteRun', snapshot) : (deleteArmed = true)"
              >
                {{ deleteArmed ? $t('agent.tasks.confirmDeleteRun') : $t('agent.tasks.deleteRun') }}
              </button>
            </div>
          </div>
        </section>

        <ToolTimeline
          v-if="approvals.some((item) => item.status === 'requested')"
          class="mt-4 rounded-2xl border border-border/60 bg-card/55 p-4"
          :approvals="approvals.filter((item) => item.status === 'requested')"
          :clock="approvalClock"
          :busy="busy"
          @resolve="(approval, decision) => $emit('resolveApproval', approval, decision)"
        />

        <details
          v-if="approvals.some((item) => item.status !== 'requested')"
          class="mt-4 rounded-xl border border-border/60 p-4"
        >
          <summary class="cursor-pointer text-xs font-medium">{{ $t('agent.ui.approvalHistory') }}</summary>
          <ToolTimeline
            class="mt-3"
            :approvals="approvals.filter((item) => item.status !== 'requested')"
            :clock="approvalClock"
            :busy="busy"
          />
        </details>
        <details class="mt-4 rounded-2xl border border-border/60 bg-card/55 p-4">
          <summary class="cursor-pointer text-sm font-medium">
            {{ $t('agent.tasks.checkpoints') }} · {{ checkpoints.length }}
          </summary>
          <div class="mt-3 flex items-center justify-between gap-2">
            <div>
              <h3 class="flex items-center gap-1.5 font-medium">
                <i class="fa-solid fa-bookmark text-xs text-text-secondary" aria-hidden="true"></i>
                {{ $t('agent.tasks.checkpoints') }}
              </h3>
              <p class="mt-1 text-xs leading-4 text-text-secondary">{{ $t('agent.tasks.checkpointHint') }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-medium hover:bg-header disabled:opacity-50"
              :disabled="busy || !canSave()"
              @click="$emit('saveCheckpoint', snapshot)"
            >
              <i class="fa-solid fa-plus mr-1 text-[9px]" aria-hidden="true"></i>
              {{ $t('agent.tasks.saveCheckpoint') }}
            </button>
          </div>
          <div
            v-if="checkpoints.length === 0"
            class="mt-3 rounded-xl bg-background/70 px-3 py-3 text-xs text-text-secondary"
          >
            {{ $t('agent.tasks.noCheckpoints') }}
          </div>
          <article v-for="checkpoint in checkpoints" :key="checkpoint.id" class="mt-2 rounded-xl bg-background/70 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-xs">{{ checkpoint.id }}</div>
                <div class="mt-1 text-xs text-text-secondary">
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
                class="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                :disabled="busy || snapshot.needsReconciliation"
                @click="$emit('resumeCheckpoint', snapshot, checkpoint)"
              >
                {{ $t('agent.tasks.resumeCheckpoint') }}
              </button>
            </div>
          </article>
        </details>

        <details class="mt-4 rounded-xl border border-border/60 p-4">
          <summary class="cursor-pointer text-sm font-medium">{{ $t('agent.ui.optionalRuntime') }}</summary>
          <WorkspaceRuntimePanel :app-id="snapshot.appId" :run-id="snapshot.id" :busy="busy" />
        </details>

        <SubagentTree
          v-if="subagents.length"
          :items="subagents"
          :selected-id="selectedSubagentId"
          :messages="subagentMessages"
          :busy="busy"
          @select="$emit('selectSubagent', $event)"
          @cancel="$emit('cancelSubagent', $event)"
        />

        <details class="mt-4 rounded-2xl border border-border/60 bg-card/55 p-4">
          <summary class="cursor-pointer text-xs font-medium">
            <i class="fa-solid fa-wave-square mr-1.5 text-xs text-text-secondary" aria-hidden="true"></i>
            {{ $t('agent.tasks.recentFacts') }} · {{ snapshot.recentEntries.length }}
          </summary>
          <article v-for="entry in snapshot.recentEntries" :key="entry.id" class="mt-2 rounded-xl bg-background/70 p-3">
            <div class="text-xs text-text-secondary">#{{ entry.sequence }} · {{ entry.kind }}</div>
            <pre class="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-xs leading-4">{{
              JSON.stringify(entry.payload, null, 2)
            }}</pre>
          </article>
        </details>
      </template>
    </div>
  </aside>
</template>
