<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { AgentHardLimits, AgentSettingsView, HardLimitPreview } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsView; preview: HardLimitPreview | null; busy: boolean }>();
  const emit = defineEmits<{
    preview: [proposed: Partial<AgentHardLimits>];
    confirm: [confirmationId: string, expectedVersion: number];
    dismiss: [];
  }>();

  const draft = ref<Record<string, string>>({});
  const reset = () => {
    draft.value = Object.fromEntries(
      Object.entries(props.settings.hardLimits).map(([key, value]) => [key, value === null ? '' : String(value)]),
    );
  };
  watch(() => props.settings.revision, reset, { immediate: true });

  const proposedChanges = computed<Partial<AgentHardLimits>>(() => {
    const result: Record<string, number | null> = {};
    for (const [key, current] of Object.entries(props.settings.hardLimits)) {
      const raw = draft.value[key] ?? '';
      const next = key === 'maxRunCostMicros' && raw.trim() === '' ? null : Number(raw);
      if (next !== current && (next === null || (Number.isSafeInteger(next) && next >= 0))) result[key] = next;
    }
    return result as Partial<AgentHardLimits>;
  });

  const canPreview = computed(() => Object.keys(proposedChanges.value).length > 0 && !props.busy);
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.hardLimits.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.hardLimits.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canPreview"
        @click="emit('preview', proposedChanges)"
      >
        {{ $t('agent.settings.hardLimits.review') }}
      </button>
    </div>

    <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <label v-for="(_, key) in settings.hardLimits" :key="key" class="block">
        <span class="mb-1 block break-all text-xs font-medium text-text-secondary">{{ key }}</span>
        <input
          v-model="draft[String(key)]"
          type="number"
          min="0"
          step="1"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          :placeholder="key === 'maxRunCostMicros' ? $t('agent.settings.hardLimits.unlimited') : undefined"
        />
        <span
          v-if="settings.requestedSettings.hardLimits[key] !== settings.effectiveSettings.hardLimits[key]"
          class="mt-1 block text-xs text-text-secondary"
        >
          {{ $t('agent.settings.hardLimits.effective', { value: settings.effectiveSettings.hardLimits[key] }) }}
        </span>
      </label>
    </div>

    <div v-if="preview" class="mt-5 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold">{{ $t('agent.settings.hardLimits.confirmTitle') }}</h3>
          <p class="mt-1 text-sm text-text-secondary">
            {{
              $t('agent.settings.hardLimits.confirmDescription', {
                count: preview.impact.changes.length,
                runtimes: preview.impact.usage.executingRuntimes,
              })
            }}
          </p>
        </div>
        <span v-if="preview.impact.hasIncrease" class="rounded bg-warning/15 px-2 py-1 text-xs text-warning">
          {{ $t('agent.settings.hardLimits.increaseWarning') }}
        </span>
      </div>
      <div class="mt-3 max-h-60 space-y-2 overflow-y-auto">
        <div
          v-for="change in preview.impact.changes"
          :key="change.key"
          class="flex items-center justify-between gap-3 rounded bg-background px-3 py-2 text-sm"
        >
          <span class="min-w-0 break-all">{{ change.key }}</span>
          <span class="shrink-0 font-mono text-xs"> {{ change.current ?? '∞' }} → {{ change.proposed ?? '∞' }} </span>
        </div>
      </div>
      <p class="mt-3 text-xs text-text-secondary">
        {{
          $t('agent.settings.hardLimits.usage', {
            bytes: preview.impact.usage.artifactUsedBytes + preview.impact.usage.artifactReservedBytes,
          })
        }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md px-3 py-2 text-sm hover:bg-header"
          :disabled="busy"
          @click="emit('dismiss')"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy"
          @click="emit('confirm', preview.confirmationId, preview.expectedVersion)"
        >
          {{ $t('agent.settings.hardLimits.confirm') }}
        </button>
      </div>
    </div>
  </section>
</template>
