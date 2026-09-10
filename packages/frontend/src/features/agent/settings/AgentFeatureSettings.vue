<script setup lang="ts">
  import type { AgentSettingsView } from '../api/agent-api';

  defineProps<{ settings: AgentSettingsView; busy: boolean }>();
  const emit = defineEmits<{ change: [enabled: boolean] }>();
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.feature.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.feature.description') }}</p>
        <p class="mt-2 text-xs text-text-secondary">
          {{ $t('agent.settings.feature.state', { state: settings.availability.state }) }}
        </p>
      </div>
      <button
        type="button"
        class="rounded-md px-4 py-2 text-sm font-medium focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        :class="settings.effectiveSettings.feature.enabled ? 'bg-error/15 text-error' : 'bg-primary text-white'"
        :disabled="busy"
        @click="emit('change', !settings.effectiveSettings.feature.enabled)"
      >
        {{
          settings.effectiveSettings.feature.enabled
            ? $t('agent.settings.feature.disable')
            : $t('agent.settings.feature.enable')
        }}
      </button>
    </div>
  </section>
</template>
