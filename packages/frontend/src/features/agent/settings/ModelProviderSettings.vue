<script setup lang="ts">
  import { computed, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    formatAgentApiError,
    type AgentDiscoveredProviderModel,
    type AgentProviderView,
  } from '../api/agent-api';

  const props = defineProps<{
    addProviderModel: (
      provider: AgentProviderView,
      model: AgentProviderView['models'][number],
    ) => Promise<boolean | undefined>;
    createProvider: (input: Record<string, unknown>) => Promise<boolean | undefined>;
    providers: AgentProviderView[];
    busy: boolean;
    discoveries: Record<string, AgentDiscoveredProviderModel[]>;
    defaultProviderId: string | null;
    defaultModelId: string | null;
  }>();
  const emit = defineEmits<{
    toggle: [provider: AgentProviderView, enabled: boolean];
    protocol: [provider: AgentProviderView, protocol: AgentProviderView['protocol']];
    discover: [provider: AgentProviderView];
    defaultModel: [providerId: string, modelId: string];
  }>();

  const { t } = useI18n();
  const testResults = reactive<Record<string, { state: 'loading' | 'success' | 'error'; message: string }>>({});
  const testKey = (provider: AgentProviderView, modelId: string) =>
    JSON.stringify([provider.id, provider.version, modelId]);
  const testModel = async (provider: AgentProviderView, modelId: string) => {
    const key = testKey(provider, modelId);
    if (testResults[key]?.state === 'loading') return;
    testResults[key] = { state: 'loading', message: t('agent.ui.testing') };
    try {
      const result = await agentApi.testProvider(provider.id, modelId);
      testResults[key] = result.ok
        ? { state: 'success', message: t('agent.ui.testSuccess', { ms: result.latencyMs }) }
        : { state: 'error', message: t('agent.ui.testFailed') };
    } catch (cause) {
      testResults[key] = { state: 'error', message: formatAgentApiError(cause, t('agent.ui.testFailed')) };
    }
  };
  const createError = ref('');
  const showCreate = ref(false);
  const discoveryDrafts = reactive<
    Record<
      string,
      { modelId: string; contextWindow: number | null; maxOutputTokens: number | null; supportsTools: boolean }
    >
  >({});

  const discoveryDraft = (provider: AgentProviderView) => {
    const existing = discoveryDrafts[provider.id];
    if (existing) return existing;
    const created = { modelId: '', contextWindow: null, maxOutputTokens: null, supportsTools: false };
    discoveryDrafts[provider.id] = created;
    return created;
  };

  const availableDiscoveries = (provider: AgentProviderView): AgentDiscoveredProviderModel[] => {
    const configured = new Set(provider.models.map((model) => model.id));
    return (props.discoveries[provider.id] ?? []).filter((model) => !configured.has(model.id));
  };

  const addDiscoveredModel = async (provider: AgentProviderView): Promise<void> => {
    const draft = discoveryDraft(provider);
    if (
      !draft.modelId ||
      draft.contextWindow === null ||
      draft.maxOutputTokens === null ||
      !Number.isSafeInteger(draft.contextWindow) ||
      !Number.isSafeInteger(draft.maxOutputTokens) ||
      draft.contextWindow < 1 ||
      draft.maxOutputTokens < 1 ||
      draft.maxOutputTokens > draft.contextWindow
    ) {
      return;
    }
    const saved = await props.addProviderModel(provider, {
      id: draft.modelId,
      contextWindow: draft.contextWindow,
      maxOutputTokens: draft.maxOutputTokens,
      supportsTools: draft.supportsTools,
    });
    if (!saved) return;
    draft.modelId = '';
    draft.contextWindow = null;
    draft.maxOutputTokens = null;
    draft.supportsTools = false;
  };
  const form = reactive({
    displayName: '',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'chat-completions' as AgentProviderView['protocol'],
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

  const create = async () => {
    createError.value = '';
    const saved = await props.createProvider({
      kind: 'openai-compatible',
      displayName: form.displayName,
      baseUrl: form.baseUrl,
      protocol: form.protocol,
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
    if (saved) {
      showCreate.value = false;
      form.credential = '';
    } else createError.value = t('agent.ui.createFailed');
  };

  const setDefaultModel = (value: string): void => {
    const option = modelOptions.value.find((candidate) => candidate.key === value);
    if (option) emit('defaultModel', option.provider.id, option.model.id);
  };

  const protocolFromEvent = (event: Event): AgentProviderView['protocol'] =>
    (event.target as HTMLSelectElement).value === 'responses' ? 'responses' : 'chat-completions';
</script>

<template>
  <section class="rounded-2xl border border-border/60 bg-card/65 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-base font-semibold">{{ $t('agent.settings.providers.title') }}</h2>
          <span class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary">
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

    <div class="mt-4 rounded-2xl bg-primary/5 p-4">
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
        <div class="max-w-sm text-xs leading-5 text-text-secondary">
          {{ $t('agent.settings.providers.defaultModelHint') }}
        </div>
      </div>
    </div>

    <form
      v-if="showCreate"
      class="mt-4 grid gap-4 rounded-xl border border-border/60 bg-background p-4 md:grid-cols-2"
      @submit.prevent="create"
    >
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.name') }}</span>
        <input
          v-model="form.displayName"
          required
          maxlength="200"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
        />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.baseUrl') }}</span>
        <input
          v-model="form.baseUrl"
          required
          type="url"
          class="w-full rounded-md border border-border bg-card px-3 py-2"
        />
      </label>
      <label>
        <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.providers.protocol') }}</span>
        <select v-model="form.protocol" class="w-full rounded-md border border-border bg-card px-3 py-2">
          <option value="chat-completions">{{ $t('agent.settings.providers.protocolChat') }}</option>
          <option value="responses">{{ $t('agent.settings.providers.protocolResponses') }}</option>
        </select>
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
        <input v-model="form.modelId" required class="w-full rounded-md border border-border bg-card px-3 py-2" />
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
      <p v-if="createError" role="alert" class="text-sm text-error md:col-span-2">{{ createError }}</p>
      <div class="flex justify-end md:col-span-2">
        <button
          type="submit"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="
            busy ||
            !form.displayName.trim() ||
            !form.baseUrl.trim() ||
            !form.modelId.trim() ||
            !Number.isSafeInteger(form.contextWindow) ||
            !Number.isSafeInteger(form.maxOutputTokens) ||
            form.maxOutputTokens < 1 ||
            form.contextWindow < form.maxOutputTokens
          "
        >
          {{ $t('agent.settings.providers.create') }}
        </button>
      </div>
    </form>

    <div class="mt-4 space-y-3">
      <article
        v-for="provider in providers"
        :key="provider.id"
        class="rounded-2xl border border-border/50 bg-background/70 p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ provider.displayName }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[11px]"
                :class="provider.enabled ? 'bg-success/10 text-success' : 'bg-header text-text-secondary'"
              >
                {{
                  provider.enabled ? $t('agent.settings.providers.enabled') : $t('agent.settings.providers.disabled')
                }}
              </span>
              <span class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary">
                {{ $t('agent.settings.providers.modelCount', { count: provider.models.length }) }}
              </span>
              <span class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary">
                {{
                  provider.protocol === 'responses'
                    ? $t('agent.settings.providers.protocolResponses')
                    : $t('agent.settings.providers.protocolChat')
                }}
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
          <div class="flex flex-wrap items-center gap-2">
            <select
              :value="provider.protocol"
              class="h-8 rounded-md border border-border/70 bg-card px-2 text-xs"
              :aria-label="$t('agent.settings.providers.protocol')"
              :disabled="busy"
              @change="emit('protocol', provider, protocolFromEvent($event))"
            >
              <option value="chat-completions">{{ $t('agent.settings.providers.protocolChat') }}</option>
              <option value="responses">{{ $t('agent.settings.providers.protocolResponses') }}</option>
            </select>
            <button
              type="button"
              class="rounded-md border border-border/70 px-3 py-1.5 text-sm hover:bg-header disabled:opacity-50"
              :disabled="busy"
              @click="
                discoveryDraft(provider);
                emit('discover', provider);
              "
            >
              {{ $t('agent.settings.providers.discover') }}
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm hover:bg-header disabled:opacity-50"
              :disabled="busy"
              @click="emit('toggle', provider, !provider.enabled)"
            >
              {{ provider.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable') }}
            </button>
          </div>
        </div>

        <div v-if="discoveries[provider.id]" class="mt-3 rounded-xl border border-border/60 bg-card/55 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="text-xs font-semibold">{{ $t('agent.settings.providers.discoveryTitle') }}</div>
              <p class="mt-0.5 text-[10px] text-text-secondary">
                {{ $t('agent.settings.providers.discoveryHint') }}
              </p>
            </div>
            <span class="rounded-full bg-header px-2 py-0.5 text-[10px] text-text-secondary">
              {{ $t('agent.settings.providers.discoveryCount', { count: availableDiscoveries(provider).length }) }}
            </span>
          </div>
          <div v-if="availableDiscoveries(provider).length" class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <label class="xl:col-span-2">
              <span class="mb-1 block text-[10px] text-text-secondary">{{ $t('agent.settings.providers.model') }}</span>
              <select
                :value="discoveryDraft(provider).modelId"
                class="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                @change="discoveryDraft(provider).modelId = ($event.target as HTMLSelectElement).value"
              >
                <option value="">{{ $t('agent.settings.providers.discoveryChoose') }}</option>
                <option v-for="model in availableDiscoveries(provider)" :key="model.id" :value="model.id">
                  {{ model.id }}{{ model.ownedBy ? ` · ${model.ownedBy}` : '' }}
                </option>
              </select>
            </label>
            <label>
              <span class="mb-1 block text-[10px] text-text-secondary">{{
                $t('agent.settings.providers.contextWindow')
              }}</span>
              <input
                :value="discoveryDraft(provider).contextWindow ?? ''"
                type="number"
                min="1"
                class="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                @input="
                  discoveryDraft(provider).contextWindow = Number(($event.target as HTMLInputElement).value) || null
                "
              />
            </label>
            <label>
              <span class="mb-1 block text-[10px] text-text-secondary">{{
                $t('agent.settings.providers.maxOutputTokens')
              }}</span>
              <input
                :value="discoveryDraft(provider).maxOutputTokens ?? ''"
                type="number"
                min="1"
                class="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                @input="
                  discoveryDraft(provider).maxOutputTokens = Number(($event.target as HTMLInputElement).value) || null
                "
              />
            </label>
            <div class="flex items-end gap-2">
              <label class="flex h-9 items-center gap-1.5 text-[10px] text-text-secondary">
                <input
                  :checked="discoveryDraft(provider).supportsTools"
                  type="checkbox"
                  @change="discoveryDraft(provider).supportsTools = ($event.target as HTMLInputElement).checked"
                />
                {{ $t('agent.settings.providers.tools') }}
              </label>
              <button
                type="button"
                class="ml-auto h-9 rounded-lg bg-primary px-3 text-xs font-medium text-white disabled:opacity-50"
                :disabled="
                  busy ||
                  !discoveryDraft(provider).modelId ||
                  !discoveryDraft(provider).contextWindow ||
                  !discoveryDraft(provider).maxOutputTokens
                "
                @click="addDiscoveredModel(provider)"
              >
                {{ $t('agent.settings.providers.discoveryAdd') }}
              </button>
            </div>
          </div>
          <p v-else class="mt-3 text-xs text-text-secondary">{{ $t('agent.settings.providers.discoveryEmpty') }}</p>
        </div>

        <div class="mt-3 grid gap-2" :class="provider.models.length > 1 ? 'xl:grid-cols-2' : ''">
          <div v-for="model in provider.models" :key="model.id" class="rounded-xl bg-card/80 px-3.5 py-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="truncate text-xs font-semibold">{{ model.id }}</span>
                  <span
                    v-if="provider.id === defaultProviderId && model.id === defaultModelId"
                    class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  >
                    {{ $t('agent.settings.providers.defaultBadge') }}
                  </span>
                </div>
                <div class="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-text-secondary">
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
                class="shrink-0 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] font-medium hover:bg-header disabled:opacity-50"
                :disabled="busy || !provider.enabled || testResults[testKey(provider, model.id)]?.state === 'loading'"
                :aria-label="`${model.id} · ${$t('agent.settings.providers.test')}`"
                @click="testModel(provider, model.id)"
              >
                {{
                  testResults[testKey(provider, model.id)]?.state === 'loading'
                    ? $t('agent.ui.testing')
                    : $t('agent.settings.providers.test')
                }}
              </button>
            </div>
            <div v-if="model.reasoningEfforts?.length" class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span class="flex items-center gap-1 rounded-lg bg-primary/8 px-2 py-1 text-primary">
                <i class="fa-solid fa-brain text-[8px]" aria-hidden="true"></i>
                {{ $t('agent.settings.providers.reasoningAuto') }}
              </span>
              <span
                v-for="effort in model.reasoningEfforts"
                :key="effort"
                class="rounded-lg bg-header px-2 py-1 text-text-secondary"
                :class="effort === model.defaultReasoningEffort ? 'font-medium text-foreground' : ''"
              >
                {{ $t(`agent.ui.reasoningLevels.${effort}`) }}
              </span>
            </div>
            <p
              v-if="testResults[testKey(provider, model.id)]"
              class="mt-2 break-words border-t border-border/40 pt-2 text-xs"
              :class="
                testResults[testKey(provider, model.id)]?.state === 'error'
                  ? 'text-error'
                  : testResults[testKey(provider, model.id)]?.state === 'success'
                    ? 'text-success'
                    : 'text-text-secondary'
              "
              role="status"
              aria-live="polite"
            >
              {{ testResults[testKey(provider, model.id)]?.message }}
            </p>
          </div>
        </div>
      </article>
      <p v-if="providers.length === 0" class="text-sm text-text-secondary">
        {{ $t('agent.settings.providers.empty') }}
      </p>
    </div>
  </section>
</template>
