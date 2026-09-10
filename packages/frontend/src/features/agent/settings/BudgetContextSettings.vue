<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type { AgentSettingsView } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsView; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const draft = ref<Record<string, string>>({});

  watch(
    () => props.settings.revision,
    () => {
      draft.value = Object.fromEntries(
        Object.entries(props.settings.requestedSettings.budget).map(([key, value]) => [
          key,
          value === null ? '' : String(value),
        ]),
      );
    },
    { immediate: true },
  );

  const save = () => {
    const patch: Record<string, number | null> = {};
    for (const [key, raw] of Object.entries(draft.value)) {
      patch[key] = key === 'maxRunCostMicros' && raw.trim() === '' ? null : Number(raw);
    }
    emit('save', patch);
  };
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <h2 class="text-base font-semibold">{{ $t('agent.settings.budget.title') }}</h2>
    <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.budget.description') }}</p>
    <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <label v-for="(value, key) in settings.requestedSettings.budget" :key="key">
        <span class="mb-1 block break-all text-xs font-medium text-text-secondary">{{ key }}</span>
        <input
          v-model="draft[String(key)]"
          type="number"
          min="0"
          step="1"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          :placeholder="key === 'maxRunCostMicros' ? $t('agent.settings.hardLimits.unlimited') : undefined"
        />
        <span v-if="value !== settings.effectiveSettings.budget[key]" class="mt-1 block text-xs text-warning">
          {{ $t('agent.settings.hardLimits.effective', { value: settings.effectiveSettings.budget[key] }) }}
        </span>
      </label>
    </div>
    <div class="mt-4 flex justify-end">
      <button
        type="button"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="busy"
        @click="save"
      >
        {{ $t('common.save') }}
      </button>
    </div>
  </section>
</template>
