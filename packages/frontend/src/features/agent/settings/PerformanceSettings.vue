<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type { AgentSettingsView } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsView; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const runtimes = ref(1);
  const modelCalls = ref<string>('auto');

  watch(
    () => props.settings.revision,
    () => {
      runtimes.value = props.settings.requestedSettings.performance.maxConcurrentRuntimes;
      modelCalls.value = String(props.settings.requestedSettings.performance.maxConcurrentModelCalls);
    },
    { immediate: true },
  );

  const save = () => {
    const parsedModel = modelCalls.value === 'auto' ? 'auto' : Number(modelCalls.value);
    emit('save', {
      maxConcurrentRuntimes: runtimes.value,
      maxConcurrentModelCalls: parsedModel,
    });
  };
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <h2 class="text-base font-semibold">{{ $t('agent.settings.performance.title') }}</h2>
    <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.performance.description') }}</p>
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <label>
        <span class="mb-1 block text-sm">{{ $t('agent.settings.performance.runtimes') }}</span>
        <input
          v-model.number="runtimes"
          type="number"
          min="1"
          class="w-full rounded-md border border-border bg-background px-3 py-2"
        />
        <span class="mt-1 block text-xs text-text-secondary">
          {{
            $t('agent.settings.performance.limit', {
              effective: settings.effectiveSettings.performance.maxConcurrentRuntimes,
              hard: settings.hardLimits.maxConcurrentRuntimes,
            })
          }}
        </span>
      </label>
      <label>
        <span class="mb-1 block text-sm">{{ $t('agent.settings.performance.modelCalls') }}</span>
        <select v-model="modelCalls" class="w-full rounded-md border border-border bg-background px-3 py-2">
          <option value="auto">{{ $t('agent.settings.performance.auto') }}</option>
          <option v-for="value in settings.hardLimits.maxConcurrentModelCalls" :key="value" :value="String(value)">
            {{ value }}
          </option>
        </select>
        <span class="mt-1 block text-xs text-text-secondary">
          {{
            $t('agent.settings.performance.limit', {
              effective: settings.effectiveSettings.performance.maxConcurrentModelCalls,
              hard: settings.hardLimits.maxConcurrentModelCalls,
            })
          }}
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
