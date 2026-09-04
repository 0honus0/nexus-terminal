<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseModal, BaseTable } from '@/foundation/ui';
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
  onMounted(() => data.load());
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
  <main class="mx-auto max-w-6xl space-y-5 p-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">{{ t('proxies.title') }}</h1>
      <BaseButton data-testid="proxy-add-button" variant="primary" @click="openAdd">{{
        t('proxies.addProxy')
      }}</BaseButton>
    </div>
    <BaseTable :empty="data.proxies.value.length === 0" :empty-text="t('proxies.noProxies')"
      ><template #head
        ><tr>
          <th class="px-3 py-2">{{ t('proxies.form.name') }}</th>
          <th class="px-3 py-2">{{ t('proxies.form.type') }}</th>
          <th class="px-3 py-2">{{ t('proxies.form.host') }}</th>
          <th class="px-3 py-2">{{ t('proxies.form.username') }}</th>
          <th class="px-3 py-2">{{ t('proxies.updatedAt') }}</th>
          <th></th></tr
      ></template>
      <tr v-for="proxy in data.proxies.value" :key="proxy.id" :data-testid="`proxy-row-${proxy.id}`">
        <td class="px-3 py-2">{{ proxy.name }}</td>
        <td class="px-3 py-2">{{ proxy.type }}</td>
        <td class="px-3 py-2">{{ proxy.host }}:{{ proxy.port }}</td>
        <td class="px-3 py-2 text-text-secondary">{{ proxy.username || '—' }}</td>
        <td class="px-3 py-2 text-text-secondary">{{ new Date(proxy.updatedAt * 1000).toLocaleString() }}</td>
        <td class="px-3 py-2">
          <div class="flex justify-end gap-2">
            <BaseButton
              data-testid="proxy-edit"
              size="sm"
              @click="
                editing = proxy;
                modal = true;
              "
              >{{ t('common.edit') }}</BaseButton
            ><BaseButton data-testid="proxy-delete" size="sm" variant="danger" @click="remove(proxy)">{{
              t('common.delete')
            }}</BaseButton>
          </div>
        </td>
      </tr></BaseTable
    ><BaseModal
      :visible="modal"
      :title="editing ? t('proxies.form.titleEdit') : t('proxies.form.title')"
      @close="modal = false"
      ><ProxyForm :proxy="editing" :loading="loading" @submit="save" @cancel="modal = false"
    /></BaseModal>
  </main>
</template>
