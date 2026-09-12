<script setup lang="ts">
  import { computed, reactive, ref } from 'vue';
  import type { AgentProviderView } from '../api/agent-api';

  const props = defineProps<{
    providers: AgentProviderView[];
    busy: boolean;
    defaultProviderId: string | null;
    defaultModelId: string | null;
  }>();
  const emit = defineEmits<{
    create: [input: Record<string, unknown>];
    toggle: [provider: AgentProviderView, enabled: boolean];
    test: [provider: AgentProviderView, modelId: string];
    defaultModel: [providerId: string, modelId: string];
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

  const modelOptions = computed(() =>
    props.providers
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          key: `${provider.id}\u0000${model.id}`,
          provider,
          model,
        })),
      ),
  );
  const defaultModelKey = computed(() =>
    props.defaultProviderId && props.defaultModelId ? `${props.defaultProviderId}\u0000${props.defaultModelId}` : '',
  );
  const modelCount = computed(() => props.providers.reduce((total, provider) => total + provider.models.length, 0));
  const compactTokens = (value: number): string => {
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
    if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
    return String(value);
  };

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

  const setDefaultModel = (value: string): void => {
    const option = modelOptions.value.find((candidate) => candidate.key === value);
    if (option) emit('defaultModel', option.provider.id, option.model.id);
  };
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-base font-semibold">{{ $t('agent.settings.providers.title') }}</h2>
          <span class="rounded-full bg-header px-2 py-0.5 text-[10px] text-text-secondary">
            {{ $t('agent.settings.providers.counts', { providers: providers.length, models: modelCount }) }}
          </span>
        </div>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.providers.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="busy"
        @click="showCreate = !showCreate"
      >
        {{ showCreate ? $t('common.cancel') : $t('agent.settings.providers.add') }}
      </button>
    </div>

    <div class="mt-4 rounded-xl border border-border/80 bg-background p-3.5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <label class="min-w-0 flex-1">
          <span class="mb-1 block text-xs font-medium">{{ $t('agent.settings.providers.defaultModel') }}</span>
          <select
            :value="defaultModelKey"
            class="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary disabled:opacity-50"
            :aria-label="$t('agent.settings.providers.defaultModel')"
            :disabled="busy || modelOptions.length === 0"
            @change="setDefaultModel(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>{{ $t('agent.settings.providers.chooseDefault') }}</option>
            <option v-for="option in modelOptions" :key="option.key" :value="option.key">
              {{ option.provider.displayName }} · {{ option.model.id }}
            </option>
          </select>
        </label>
        <div class="max-w-sm text-[11px] leading-4 text-text-secondary">
          {{ $t('agent.settings.providers.defaultModelHint') }}
        </div>
      </div>
    </div>

    <div v-if="showCreate" class="mt-4 grid gap-3 rounded-xl bg-background p-4 md:grid-cols-2">
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.name') }}</span>
        <input v-model="form.displayName" class="w-full rounded-md border border-border bg-card px-3 py-2" />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.baseUrl') }}</span>
        <input v-model="form.baseUrl" class="w-full rounded-md border border-border bg-card px-3 py-2" />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.credential') }}</span>
        <input
          v-model="form.credential"
          type="password"
          autocomplete="new-password"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
        />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.model') }}</span>
        <input v-model="form.modelId" class="w-full rounded-md border border-border bg-card px-3 py-2" />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.contextWindow') }}</span>
        <input
          v-model.number="form.contextWindow"
          type="number"
          min="1"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
        />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.maxOutputTokens') }}</span>
        <input
          v-model.number="form.maxOutputTokens"
          type="number"
          min="1"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
        />
      </label>
      <label class="flex items-center gap-2">
        <input v-model="form.supportsTools" type="checkbox" />
        <span class="text-sm">{{ $t('agent.settings.providers.tools') }}</span>
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{
          $t('agent.settings.providers.privateExceptions')
        }}</span>
        <input
          v-model="form.privateHostExceptions"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
          placeholder="10.0.0.8:8080"
        />
      </label>
      <div class="flex justify-end md:col-span-2">
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
      <article
        v-for="provider in providers"
        :key="provider.id"
        class="rounded-xl border border-border/70 bg-background p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ provider.displayName }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px]"
                :class="provider.enabled ? 'bg-success/10 text-success' : 'bg-header text-text-secondary'"
              >
                {{
                  provider.enabled ? $t('agent.settings.providers.enabled') : $t('agent.settings.providers.disabled')
                }}
              </span>
              <span class="rounded-full bg-header px-2 py-0.5 text-[10px] text-text-secondary">
                {{ $t('agent.settings.providers.modelCount', { count: provider.models.length }) }}
              </span>
            </div>
            <p class="mt-1 truncate text-xs text-text-secondary">{{ provider.baseUrl }}</p>
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
            class="rounded-md px-3 py-1.5 text-sm hover:bg-header disabled:opacity-50"
            :disabled="busy"
            @click="emit('toggle', provider, !provider.enabled)"
          >
            {{ provider.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable') }}
          </button>
        </div>

        <div class="mt-3 grid gap-2 xl:grid-cols-2">
          <div
            v-for="model in provider.models"
            :key="model.id"
            class="rounded-lg border border-border/70 bg-card px-3 py-2.5"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="truncate text-xs font-semibold">{{ model.id }}</span>
                  <span
                    v-if="provider.id === defaultProviderId && model.id === defaultModelId"
                    class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
                  >
                    {{ $t('agent.settings.providers.defaultBadge') }}
                  </span>
                </div>
                <div class="mt-1 flex flex-wrap gap-1 text-[9px] text-text-secondary">
                  <span class="rounded bg-header px-1.5 py-0.5">
                    {{ $t('agent.settings.providers.contextShort', { value: compactTokens(model.contextWindow) }) }}
                  </span>
                  <span class="rounded bg-header px-1.5 py-0.5">
                    {{ $t('agent.settings.providers.outputShort', { value: compactTokens(model.maxOutputTokens) }) }}
                  </span>
                  <span class="rounded bg-header px-1.5 py-0.5">
                    {{
                      model.supportsTools
                        ? $t('agent.settings.providers.toolCapable')
                        : $t('agent.settings.providers.modelOnly')
                    }}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="shrink-0 rounded border border-border px-2 py-1 text-[10px] hover:bg-header disabled:opacity-50"
                :disabled="busy || !provider.enabled"
                @click="emit('test', provider, model.id)"
              >
                {{ model.id }} · {{ $t('agent.settings.providers.test') }}
              </button>
            </div>
          </div>
        </div>
      </article>
      <p v-if="providers.length === 0" class="text-sm text-text-secondary">
        {{ $t('agent.settings.providers.empty') }}
      </p>
    </div>
  </section>
</template>
