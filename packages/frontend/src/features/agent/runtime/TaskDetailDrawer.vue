<script setup lang="ts">
  import type {
    AgentCheckpointView,
    AgentRunSnapshot,
    AgentSubagentMessage,
    AgentSubagentView,
  } from '../api/agent-api';
  import EnvironmentWorkspacePanel from './EnvironmentWorkspacePanel.vue';
  import SubagentTree from './SubagentTree.vue';

  const props = defineProps<{
    snapshot: AgentRunSnapshot | null;
    checkpoints: AgentCheckpointView[];
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
  }>();

  const terminal = new Set(['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted']);
  const canSave = () =>
    Boolean(props.snapshot && props.snapshot.status !== 'cancelling' && !props.snapshot.needsReconciliation);
</script>

<template>
  <aside
    v-if="visible"
    class="absolute inset-y-0 right-0 z-20 w-[min(480px,92%)] border-l border-border bg-card shadow-xl"
  >
    <header class="flex items-center justify-between border-b border-border px-4 py-3">
      <strong class="text-sm">{{ $t('agent.tasks.detail') }}</strong>
      <button type="button" class="h-8 w-8 rounded hover:bg-header" @click="$emit('close')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </header>
    <div class="h-[calc(100%-52px)] overflow-y-auto p-4 text-xs">
      <template v-if="snapshot">
        <dl class="grid grid-cols-[120px_1fr] gap-2">
          <dt class="text-text-secondary">{{ $t('agent.tasks.status') }}</dt>
          <dd>{{ snapshot.status }}</dd>
          <dt class="text-text-secondary">{{ $t('agent.tasks.verification') }}</dt>
          <dd>{{ snapshot.verificationStatus }}</dd>
          <dt class="text-text-secondary">{{ $t('agent.tasks.goal') }}</dt>
          <dd>{{ snapshot.goalStatus }}</dd>
          <dt class="text-text-secondary">{{ $t('agent.tasks.runId') }}</dt>
          <dd class="break-all font-mono text-[10px]">{{ snapshot.id }}</dd>
        </dl>

        <section class="mt-4 rounded border border-border p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h3 class="font-medium">{{ $t('agent.tasks.checkpoints') }}</h3>
              <p class="mt-0.5 text-[10px] text-text-secondary">{{ $t('agent.tasks.checkpointHint') }}</p>
            </div>
            <button
              type="button"
              class="rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"
              :disabled="busy || !canSave()"
              @click="$emit('saveCheckpoint', snapshot)"
            >
              {{ $t('agent.tasks.saveCheckpoint') }}
            </button>
          </div>
          <p v-if="checkpoints.length === 0" class="mt-2 text-[10px] text-text-secondary">
            {{ $t('agent.tasks.noCheckpoints') }}
          </p>
          <article v-for="checkpoint in checkpoints" :key="checkpoint.id" class="mt-2 rounded bg-background p-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-[10px]">{{ checkpoint.id }}</div>
                <div class="mt-0.5 text-[10px] text-text-secondary">
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
                class="rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50"
                :disabled="busy || snapshot.needsReconciliation"
                @click="$emit('resumeCheckpoint', snapshot, checkpoint)"
              >
                {{ $t('agent.tasks.resumeCheckpoint') }}
              </button>
            </div>
          </article>
        </section>

        <EnvironmentWorkspacePanel :app-id="snapshot.appId" :run-id="snapshot.id" :busy="busy" />

        <SubagentTree
          :items="subagents"
          :selected-id="selectedSubagentId"
          :messages="subagentMessages"
          :busy="busy"
          @select="$emit('selectSubagent', $event)"
          @cancel="$emit('cancelSubagent', $event)"
        />

        <h3 class="mt-4 font-medium">{{ $t('agent.tasks.recentFacts') }}</h3>
        <article v-for="entry in snapshot.recentEntries" :key="entry.id" class="mt-2 rounded border border-border p-2">
          <div class="text-[10px] text-text-secondary">#{{ entry.sequence }} · {{ entry.kind }}</div>
          <pre class="mt-1 whitespace-pre-wrap break-words text-[10px]">{{
            JSON.stringify(entry.payload, null, 2)
          }}</pre>
        </article>
      </template>
    </div>
  </aside>
</template>
