<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type { TargetDenylistView } from '../api/agent-api';

  const props = defineProps<{ denylist: TargetDenylistView; busy: boolean }>();
  const emit = defineEmits<{ save: [connectionIds: number[], reason: string] }>();
  const ids = ref('');
  const reason = ref('');

  watch(
    () => props.denylist.revision,
    () => {
      ids.value = props.denylist.list.map((entry) => entry.connectionId).join(', ');
      reason.value = '';
    },
    { immediate: true },
  );

  const save = () => {
    const connectionIds = [
      ...new Set(
        ids.value
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isSafeInteger(value) && value > 0),
      ),
    ];
    if (!reason.value.trim()) return;
    emit('save', connectionIds, reason.value.trim());
  };
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <h2 class="text-base font-semibold">{{ $t('agent.settings.safety.title') }}</h2>
    <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.safety.description') }}</p>
    <div class="mt-4 rounded-md border border-border bg-background p-3 text-sm text-text-secondary">
      {{ $t('agent.settings.safety.guardrails') }}
    </div>
    <div class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <label>
        <span class="mb-1 block text-sm">{{ $t('agent.settings.safety.connectionIds') }}</span>
        <input
          v-model="ids"
          type="text"
          class="w-full rounded-md border border-border bg-background px-3 py-2"
          placeholder="12, 18"
        />
      </label>
      <label>
        <span class="mb-1 block text-sm">{{ $t('agent.settings.safety.reason') }}</span>
        <input
          v-model="reason"
          type="text"
          maxlength="512"
          class="w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>
      <button
        type="button"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="busy || !reason.trim()"
        @click="save"
      >
        {{ $t('common.save') }}
      </button>
    </div>
    <p class="mt-2 text-xs text-text-secondary">
      {{ $t('agent.settings.safety.revision', { revision: denylist.revision }) }}
    </p>
  </section>
</template>
