<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import ProxyForm from '../components/ProxyForm.vue';
  import { useProxies } from '../composables/useProxies';
  import type { Proxy, ProxyInput } from '../model/proxy';
  const { t } = useI18n();
  const data = useProxies();
  const feedback = useFeedback();
  const modal = ref(false);
  const editing = ref<Proxy | null>(null);
  const loading = ref(false);
  const loadError = ref('');
  const initialLoading = ref(true);
  onMounted(async () => {
    initialLoading.value = true;
    loadError.value = '';
    try {
      await data.load();
    } catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      initialLoading.value = false;
    }
  });
  const openAdd = () => {
    editing.value = null;
    modal.value = true;
  };
  const save = async (input: Partial<ProxyInput>) => {
    loading.value = true;
    try {
      if (editing.value) await data.update(editing.value.id, input);
      else await data.create(input as ProxyInput);
      modal.value = false;
    } catch (cause) {
      feedback.notifyError(
        t(editing.value ? 'proxies.form.errorUpdate' : 'proxies.form.errorAdd', {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      loading.value = false;
    }
  };
  const remove = async (p: Proxy) => {
    if (await feedback.confirm({ message: t('proxies.prompts.confirmDelete', { name: p.name }), destructive: true }))
      await data.remove(p.id);
  };
</script>
<template>
  <div class="bg-background p-4 text-foreground">
    <div class="mx-auto max-w-6xl">
      <h2 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">{{ t('proxies.title') }}</h2>
      <button
        v-if="!modal"
        data-testid="proxy-add-button"
        type="button"
        class="mb-4 inline-flex items-center rounded bg-button px-4 py-2 text-sm font-medium text-button-text hover:bg-button-hover"
        @click="openAdd"
      >
        {{ t('proxies.addProxy') }}
      </button>

      <div class="mt-4">
        <div
          v-if="initialLoading && data.proxies.value.length === 0"
          class="mb-4 rounded-md border border-border bg-header/50 p-4 text-center text-text-secondary italic"
        >
          {{ t('proxies.loading') }}
        </div>
        <div v-else-if="loadError" class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error">
          {{ t('proxies.error', { error: loadError }) }}
        </div>
        <div
          v-else-if="data.proxies.value.length === 0"
          class="mb-4 rounded border-l-4 border-blue-400 bg-blue-100 p-4 text-blue-700"
        >
          {{ t('proxies.noProxies') }}
        </div>
        <div v-else class="mt-4 grid gap-4">
          <article
            v-for="proxy in data.proxies.value"
            :key="proxy.id"
            :data-testid="`proxy-row-${proxy.id}`"
            class="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
          >
            <div class="flex-grow space-y-1">
              <strong class="block text-base font-semibold text-foreground">{{ proxy.name }}</strong>
              <div class="flex items-center space-x-2">
                <span
                  class="rounded-full border border-border bg-header px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
                  >{{ proxy.type }}</span
                >
              </div>
              <div class="text-sm text-text-secondary">
                <i class="fas fa-server mr-1 text-xs opacity-70" aria-hidden="true" /> {{ proxy.host }}:{{ proxy.port }}
              </div>
              <div v-if="proxy.username" class="text-sm text-text-secondary">
                <i class="fas fa-user mr-1 text-xs opacity-70" aria-hidden="true" /> {{ proxy.username }}
              </div>
              <div class="pt-1 text-xs text-text-secondary">
                <i class="fas fa-clock mr-1 opacity-70" aria-hidden="true" />
                {{ new Date(proxy.updatedAt * 1000).toLocaleString() }}
              </div>
            </div>
            <div class="flex shrink-0 items-center space-x-3 pt-1">
              <button
                data-testid="proxy-edit"
                type="button"
                class="text-sm font-medium text-link hover:text-link-hover hover:underline"
                @click="
                  editing = proxy;
                  modal = true;
                "
              >
                <i class="fas fa-pencil-alt mr-1 text-xs" aria-hidden="true" />{{ t('proxies.actions.edit') }}
              </button>
              <button
                data-testid="proxy-delete"
                type="button"
                class="text-sm font-medium text-error hover:opacity-80 hover:underline"
                @click="remove(proxy)"
              >
                <i class="fas fa-trash-alt mr-1 text-xs" aria-hidden="true" />{{ t('proxies.actions.delete') }}
              </button>
            </div>
          </article>
        </div>
      </div>

      <BaseModal
        :visible="modal"
        :close-on-backdrop="false"
        panel-class="min-w-[350px] max-w-lg"
        content-class="!py-0"
        @close="modal = false"
      >
        <ProxyForm :proxy="editing" :loading="loading" @submit="save" @cancel="modal = false" />
      </BaseModal>
    </div>
  </div>
</template>
