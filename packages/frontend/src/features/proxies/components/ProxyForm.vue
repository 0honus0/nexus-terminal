<script setup lang="ts">
  import { reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect } from '@/foundation/ui';
  import type { Proxy, ProxyInput, ProxyType } from '../model/proxy';
  const props = defineProps<{ proxy?: Proxy | null; loading?: boolean }>();
  const emit = defineEmits<{ submit: [input: Partial<ProxyInput>]; cancel: [] }>();
  const form = reactive({
    name: '',
    type: 'SOCKS5' as ProxyType,
    host: '',
    port: 1080,
    username: '',
    password: '',
    clearPassword: false,
  });
  const error = ref('');
  watch(
    () => props.proxy,
    (p) =>
      Object.assign(
        form,
        p
          ? {
              name: p.name,
              type: p.type,
              host: p.host,
              port: p.port,
              username: p.username ?? '',
              password: '',
              clearPassword: false,
            }
          : { name: '', type: 'SOCKS5', host: '', port: 1080, username: '', password: '', clearPassword: false },
      ),
    { immediate: true },
  );
  watch(
    () => form.password,
    (value) => {
      if (value) form.clearPassword = false;
    },
  );
  watch(
    () => form.clearPassword,
    (clear) => {
      if (clear) form.password = '';
    },
  );
  const submit = () => {
    error.value = '';
    const port = Number(form.port);
    if (!form.name.trim() || !form.host.trim()) {
      error.value = t('proxies.form.errorRequiredFields');
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      error.value = t('proxies.form.errorPort');
      return;
    }
    const input: Partial<ProxyInput> = {
      name: form.name.trim(),
      type: form.type,
      host: form.host.trim(),
      port,
      username: form.username || null,
    };
    if (form.clearPassword) {
      input.authMethod = 'none';
      input.password = null;
    } else if (form.password) {
      input.authMethod = 'password';
      input.password = form.password;
    } else if (!props.proxy) {
      input.authMethod = 'none';
    }
    emit('submit', input);
  };
  const { t } = useI18n();
</script>
<template>
  <div data-testid="proxy-form" class="p-2">
    <h3 class="mb-6 text-center text-lg font-semibold">
      {{ proxy ? t('proxies.form.titleEdit') : t('proxies.form.title') }}
    </h3>
    <form class="space-y-4" @submit.prevent="submit">
      <BaseFormField :label="t('proxies.form.name')"
        ><BaseInput id="proxy-name" v-model="form.name" required
      /></BaseFormField>
      <BaseFormField :label="t('proxies.form.type')"
        ><BaseSelect id="proxy-type" v-model="form.type"
          ><option value="SOCKS5">SOCKS5</option>
          <option value="HTTP">HTTP</option></BaseSelect
        ></BaseFormField
      >
      <BaseFormField :label="t('proxies.form.host')"
        ><BaseInput id="proxy-host" v-model="form.host" required
      /></BaseFormField>
      <BaseFormField :label="t('proxies.form.port')"
        ><BaseInput id="proxy-port" v-model="form.port" type="number" min="1" max="65535" required
      /></BaseFormField>
      <BaseFormField :label="`${t('proxies.form.username')} (${t('proxies.form.optional')})`"
        ><BaseInput id="proxy-username" v-model="form.username"
      /></BaseFormField>
      <BaseFormField :label="`${t('proxies.form.password')} (${t('proxies.form.optional')})`"
        ><BaseInput id="proxy-password" v-model="form.password" type="password" autocomplete="new-password" />
        <p v-if="proxy" class="mt-1 text-xs text-text-secondary">{{ t('proxies.form.passwordUpdateNote') }}</p>
        <label v-if="proxy" class="mt-2 flex cursor-pointer select-none items-center gap-2 text-sm text-text-secondary"
          ><BaseCheckbox v-model="form.clearPassword" data-testid="proxy-clear-password" />{{
            t('proxies.form.clearStoredPassword')
          }}</label
        ></BaseFormField
      >
      <p
        v-if="error"
        class="rounded-md border border-error/30 bg-error/10 p-3 text-center text-sm font-medium text-error"
      >
        {{ error }}
      </p>
      <div class="mt-6 flex justify-end space-x-3 border-t border-border pt-5">
        <BaseButton data-testid="proxy-submit" type="submit" variant="primary" :loading="loading">{{
          t('common.save')
        }}</BaseButton
        ><BaseButton type="button" :disabled="loading" @click="emit('cancel')">{{
          t('proxies.form.cancel')
        }}</BaseButton>
      </div>
    </form>
  </div>
</template>
