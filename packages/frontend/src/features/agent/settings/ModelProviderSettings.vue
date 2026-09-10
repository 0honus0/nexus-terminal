<script setup lang="ts">
  import { reactive, ref } from 'vue';
  import type { AgentProviderView } from '../api/agent-api';

  defineProps<{ providers: AgentProviderView[]; busy: boolean }>();
  const emit = defineEmits<{
    create: [input: Record<string, unknown>];
    toggle: [provider: AgentProviderView, enabled: boolean];
    test: [provider: AgentProviderView, modelId: string];
  }>();

  const showCreate = ref(false);
  const form = reactive({
    displayName: '',
    baseUrl: 'https://api.openai.com/v1',
    credential: '',
    modelId: '',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    privateHostExceptions: '',
  });

  const create = () => {
    emit('create', {
      kind: 'openai-compatible',
      displayName: form.displayName,
      baseUrl: form.baseUrl,
      ...(form.credential ? { credential: form.credential } : {}),
      models: [
        {
          id: form.modelId,
          contextWindow: form.contextWindow,
          maxOutputTokens: form.maxOutputTokens,
          supportsTools: form.supportsTools,
        },
      ],
      privateHostExceptions: form.privateHostExceptions
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      enabled: true,
    });
  };
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.providers.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.providers.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
        @click="showCreate = !showCreate"
      >
        {{ showCreate ? $t('common.cancel') : $t('agent.settings.providers.add') }}
      </button>
    </div>

    <div v-if="showCreate" class="mt-4 grid gap-3 rounded-md bg-background p-4 md:grid-cols-2">
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.name') }}</span
        ><input v-model="form.displayName" class="w-full rounded-md border border-border bg-card px-3 py-2"
      /></label>
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.baseUrl') }}</span
        ><input v-model="form.baseUrl" class="w-full rounded-md border border-border bg-card px-3 py-2"
      /></label>
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.credential') }}</span
        ><input
          v-model="form.credential"
          type="password"
          autocomplete="new-password"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
      /></label>
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.model') }}</span
        ><input v-model="form.modelId" class="w-full rounded-md border border-border bg-card px-3 py-2"
      /></label>
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.contextWindow') }}</span
        ><input
          v-model.number="form.contextWindow"
          type="number"
          min="1"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
      /></label>
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.maxOutputTokens') }}</span
        ><input
          v-model.number="form.maxOutputTokens"
          type="number"
          min="1"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
      /></label>
      <label class="flex items-center gap-2"
        ><input v-model="form.supportsTools" type="checkbox" /><span class="text-sm">{{
          $t('agent.settings.providers.tools')
        }}</span></label
      >
      <label
        ><span class="mb-1 block text-xs text-text-secondary">{{
          $t('agent.settings.providers.privateExceptions')
        }}</span
        ><input
          v-model="form.privateHostExceptions"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
          placeholder="10.0.0.8:8080"
      /></label>
      <div class="md:col-span-2 flex justify-end">
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy || !form.displayName || !form.baseUrl || !form.modelId"
          @click="create"
        >
          {{ $t('agent.settings.providers.create') }}
        </button>
      </div>
    </div>

    <div class="mt-4 space-y-3">
      <div v-for="provider in providers" :key="provider.id" class="rounded-md bg-background p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ provider.displayName }}</span>
              <span class="rounded bg-header px-2 py-0.5 text-xs text-text-secondary">{{
                provider.enabled ? $t('agent.settings.providers.enabled') : $t('agent.settings.providers.disabled')
              }}</span>
            </div>
            <p class="mt-1 text-xs text-text-secondary">{{ provider.baseUrl }}</p>
            <p class="mt-1 text-xs text-text-secondary">
              {{
                provider.hasCredential
                  ? $t('agent.settings.providers.credentialStored')
                  : $t('agent.settings.providers.noCredential')
              }}
            </p>
          </div>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm hover:bg-header"
            :disabled="busy"
            @click="emit('toggle', provider, !provider.enabled)"
          >
            {{ provider.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable') }}
          </button>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="model in provider.models"
            :key="model.id"
            type="button"
            class="rounded border border-border px-2 py-1 text-xs hover:bg-header"
            :disabled="busy || !provider.enabled"
            @click="emit('test', provider, model.id)"
          >
            {{ model.id }} · {{ $t('agent.settings.providers.test') }}
          </button>
        </div>
      </div>
      <p v-if="providers.length === 0" class="text-sm text-text-secondary">
        {{ $t('agent.settings.providers.empty') }}
      </p>
    </div>
  </section>
</template>
