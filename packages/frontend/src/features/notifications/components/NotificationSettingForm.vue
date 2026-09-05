<script setup lang="ts">
  import { computed, reactive, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect, BaseTextarea } from '@/foundation/ui';
  import { apiErrorMessage } from '@/client/http';
  import { notificationsApi } from '../api/notificationsApi';
  import type {
    NotificationChannelType,
    NotificationConfig,
    NotificationEvent,
    NotificationSetting,
    NotificationSettingInput,
  } from '../model/notification';
  const props = defineProps<{ visible: boolean; setting?: NotificationSetting | null }>();
  const emit = defineEmits<{ close: []; save: [input: NotificationSettingInput] }>();
  const { t } = useI18n();
  const events: NotificationEvent[] = [
    'LOGIN_SUCCESS',
    'LOGIN_FAILURE',
    'LOGOUT',
    'PASSWORD_CHANGED',
    '2FA_ENABLED',
    '2FA_DISABLED',
    'PASSKEY_REGISTERED',
    'PASSKEY_AUTH_SUCCESS',
    'PASSKEY_AUTH_FAILURE',
    'PASSKEY_DELETED',
    'CONNECTION_CREATED',
    'CONNECTION_UPDATED',
    'CONNECTION_DELETED',
    'PROXY_CREATED',
    'PROXY_UPDATED',
    'PROXY_DELETED',
    'TAG_CREATED',
    'TAG_UPDATED',
    'TAG_DELETED',
    'SETTINGS_UPDATED',
    'IP_WHITELIST_UPDATED',
    'IP_BLOCKED',
    'NOTIFICATION_SETTING_CREATED',
    'NOTIFICATION_SETTING_UPDATED',
    'NOTIFICATION_SETTING_DELETED',
    'SSH_CONNECT_SUCCESS',
    'SSH_CONNECT_FAILURE',
    'SSH_SHELL_FAILURE',
    'DATABASE_MIGRATION',
    'ADMIN_SETUP_COMPLETE',
  ];
  const form = reactive({
    channelType: 'webhook' as NotificationChannelType,
    name: '',
    enabled: true,
    enabledEvents: [] as NotificationEvent[],
    url: '',
    method: 'POST',
    webhookHeaders: '{}',
    webhookBodyTemplate: '',
    to: '',
    emailBodyTemplate: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: true,
    smtpUser: '',
    smtpPass: '',
    from: '',
    botToken: '',
    chatId: '',
    messageTemplate: '',
    customDomain: '',
  });
  const testing = reactive({ active: false, message: '', success: false });
  watch(
    () => [props.visible, props.setting] as const,
    () => {
      const item = props.setting;
      Object.assign(form, {
        channelType: item?.channelType ?? 'webhook',
        name: item?.name ?? '',
        enabled: item?.enabled ?? true,
        enabledEvents: item ? [...item.enabledEvents] : [],
        url: String(item?.config.url ?? ''),
        method: String(item?.config.method ?? 'POST'),
        webhookHeaders: JSON.stringify(item?.config.headers ?? {}, null, 2),
        webhookBodyTemplate: String(item?.config.bodyTemplate ?? ''),
        to: String(item?.config.to ?? ''),
        emailBodyTemplate: String(item?.config.bodyTemplate ?? ''),
        smtpHost: String(item?.config.smtpHost ?? ''),
        smtpPort: Number(item?.config.smtpPort ?? 587),
        smtpSecure: item ? Boolean(item.config.smtpSecure ?? true) : true,
        smtpUser: String(item?.config.smtpUser ?? ''),
        smtpPass: '',
        from: String(item?.config.from ?? ''),
        botToken: '',
        chatId: String(item?.config.chatId ?? ''),
        messageTemplate: String(item?.config.messageTemplate ?? ''),
        customDomain: String(item?.config.customDomain ?? ''),
      });
      testing.message = '';
    },
    { immediate: true },
  );
  const headerValidation = computed(() => {
    try {
      const value = JSON.parse(form.webhookHeaders || '{}') as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(t('settings.notifications.form.headersObjectRequired'));
      return { headers: value as Record<string, string>, error: '' };
    } catch (cause) {
      return {
        headers: {} as Record<string, string>,
        error: `${t('settings.notifications.form.invalidJson')}: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  });
  const canTest = computed(() => {
    if (props.setting) return true;
    if (form.channelType === 'webhook') return Boolean(form.url.trim()) && !headerValidation.value.error;
    if (form.channelType === 'email')
      return Boolean(form.to.trim() && form.smtpHost.trim() && Number(form.smtpPort) > 0 && form.from.trim());
    return Boolean(form.botToken.trim() && form.chatId.trim());
  });
  const buildConfig = (): NotificationConfig | null => {
    if (form.channelType === 'webhook') {
      if (headerValidation.value.error) return null;
      return {
        url: form.url,
        method: form.method,
        headers: headerValidation.value.headers,
        bodyTemplate: form.webhookBodyTemplate,
      };
    }
    if (form.channelType === 'email') {
      return {
        to: form.to,
        bodyTemplate: form.emailBodyTemplate,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser,
        ...(form.smtpPass ? { smtpPass: form.smtpPass } : {}),
        from: form.from,
      };
    }
    return {
      ...(form.botToken ? { botToken: form.botToken } : {}),
      chatId: form.chatId,
      messageTemplate: form.messageTemplate,
      customDomain: form.customDomain,
    };
  };
  const payload = (): NotificationSettingInput | null => {
    const config = buildConfig();
    return config
      ? {
          channelType: form.channelType,
          name: form.name.trim(),
          enabled: form.enabled,
          config,
          enabledEvents: [...form.enabledEvents],
        }
      : null;
  };
  const submit = (): void => {
    const input = payload();
    if (input) emit('save', input);
  };
  const toggleEvent = (event: NotificationEvent) => {
    form.enabledEvents = form.enabledEvents.includes(event)
      ? form.enabledEvents.filter((x) => x !== event)
      : [...form.enabledEvents, event];
  };
  const testChannel = async () => {
    testing.active = true;
    testing.message = '';
    try {
      if (props.setting) {
        const result = await notificationsApi.testSaved(props.setting.id);
        testing.success = result.success;
        testing.message = result.message;
        return;
      }
      const config = buildConfig();
      if (!config) {
        testing.success = false;
        testing.message = headerValidation.value.error;
        return;
      }
      const result = await notificationsApi.testUnsaved(form.channelType, config);
      testing.success = result.success;
      testing.message = result.message;
    } catch (e) {
      testing.success = false;
      testing.message = apiErrorMessage(e, t('settings.notifications.form.testFailed'));
    } finally {
      testing.active = false;
    }
  };
</script>
<template>
  <form v-if="visible" class="space-y-6 text-foreground" @submit.prevent="submit">
    <h3 class="mb-4 border-b border-border pb-2 text-lg font-semibold">
      {{ t(setting ? 'settings.notifications.form.editTitle' : 'settings.notifications.form.addTitle') }}
    </h3>

    <div class="space-y-4">
      <BaseFormField :label="t('settings.notifications.form.name')" for-id="setting-name"
        ><BaseInput id="setting-name" v-model="form.name" required
      /></BaseFormField>
      <label class="flex items-center"
        ><BaseCheckbox id="setting-enabled" v-model="form.enabled" class="mr-2" /><span
          class="text-sm text-foreground"
          >{{ t('common.enabled') }}</span
        ></label
      >
      <BaseFormField :label="t('settings.notifications.form.channelType')" for-id="setting-channel-type">
        <BaseSelect id="setting-channel-type" v-model="form.channelType" :disabled="Boolean(setting)"
          ><option value="webhook">{{ t('settings.notifications.types.webhook') }}</option>
          <option value="email">{{ t('settings.notifications.types.email') }}</option>
          <option value="telegram">{{ t('settings.notifications.types.telegram') }}</option></BaseSelect
        >
        <p v-if="setting" class="mt-1 text-xs text-text-secondary">
          {{ t('settings.notifications.form.channelTypeEditNote') }}
        </p>
      </BaseFormField>
    </div>

    <section class="mt-4 space-y-4 rounded-md border border-border bg-header/30 p-4">
      <h4 class="mb-3 border-b border-border/50 pb-2 text-base font-semibold">
        {{ t(`settings.notifications.types.${form.channelType}`) }} {{ t('common.settings') }}
      </h4>
      <template v-if="form.channelType === 'webhook'">
        <BaseFormField label="URL" for-id="webhook-url"
          ><BaseInput id="webhook-url" v-model="form.url" type="url" required
        /></BaseFormField>
        <BaseFormField :label="t('settings.notifications.form.webhookMethod')"
          ><BaseSelect id="webhook-method" v-model="form.method"
            ><option>POST</option>
            <option>GET</option>
            <option>PUT</option></BaseSelect
          ></BaseFormField
        >
        <BaseFormField :label="t('settings.notifications.form.webhookHeaders')" for-id="webhook-headers"
          ><BaseTextarea id="webhook-headers" v-model="form.webhookHeaders" rows="3" class="font-mono text-sm" />
          <p v-if="headerValidation.error" class="mt-1 text-xs text-error">
            {{ headerValidation.error }}
          </p></BaseFormField
        >
        <BaseFormField :label="t('settings.notifications.form.webhookBodyTemplate')" for-id="webhook-body"
          ><BaseTextarea
            id="webhook-body"
            v-model="form.webhookBodyTemplate"
            rows="3"
            class="font-mono text-sm"
            :placeholder="t('settings.notifications.form.webhookBodyPlaceholder')"
          />
          <p class="mt-1 text-xs text-text-secondary">
            {{ t('settings.notifications.form.templateHelp') }} {event}, {timestamp}, {details}
          </p></BaseFormField
        >
      </template>
      <template v-else-if="form.channelType === 'email'">
        <BaseFormField :label="t('settings.notifications.form.emailTo')"
          ><BaseInput v-model="form.to" type="email" multiple required />
          <p class="mt-1 text-xs text-text-secondary">
            {{ t('settings.notifications.form.emailToHelp') }}
          </p></BaseFormField
        >
        <BaseFormField :label="t('settings.notifications.form.emailBodyTemplate')"
          ><BaseTextarea
            v-model="form.emailBodyTemplate"
            rows="3"
            :placeholder="t('settings.notifications.form.emailBodyPlaceholder')"
          />
          <p class="mt-1 text-xs text-text-secondary">
            {{ t('settings.notifications.form.templateHelp') }} {event}, {timestamp}, {details}
          </p></BaseFormField
        >
        <BaseFormField :label="t('settings.notifications.form.smtpHost')"
          ><BaseInput v-model="form.smtpHost" required
        /></BaseFormField>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BaseFormField :label="t('settings.notifications.form.smtpPort')"
            ><BaseInput v-model="form.smtpPort" type="number" min="1" max="65535" required /></BaseFormField
          ><label class="flex items-end pb-2 text-sm"
            ><BaseCheckbox v-model="form.smtpSecure" class="mr-2" />{{
              t('settings.notifications.form.smtpSecure')
            }}</label
          >
        </div>
        <BaseFormField :label="t('settings.notifications.form.smtpUser')"
          ><BaseInput v-model="form.smtpUser"
        /></BaseFormField>
        <BaseFormField :label="t('settings.notifications.form.smtpPass')"
          ><BaseInput v-model="form.smtpPass" type="password"
        /></BaseFormField>
        <BaseFormField :label="t('settings.notifications.form.smtpFrom')"
          ><BaseInput v-model="form.from" type="email" required />
          <p class="mt-1 text-xs text-text-secondary">
            {{ t('settings.notifications.form.smtpFromHelp') }}
          </p></BaseFormField
        >
      </template>
      <template v-else>
        <BaseFormField :label="t('settings.notifications.form.telegramToken')"
          ><BaseInput v-model="form.botToken" type="password" :required="!setting" autocomplete="new-password" />
          <p class="mt-1 text-xs text-text-secondary">
            {{ t('settings.notifications.form.telegramTokenHelp') }}
          </p></BaseFormField
        >
        <BaseFormField :label="t('settings.notifications.form.telegramChatId')"
          ><BaseInput v-model="form.chatId" required
        /></BaseFormField>
        <BaseFormField :label="t('settings.notifications.form.telegramCustomDomain')"
          ><BaseInput v-model="form.customDomain" type="url"
        /></BaseFormField>
        <BaseFormField :label="t('settings.notifications.form.telegramMessageTemplate')"
          ><BaseTextarea
            v-model="form.messageTemplate"
            rows="3"
            :placeholder="t('settings.notifications.form.telegramMessagePlaceholder')"
        /></BaseFormField>
      </template>

      <div class="border-t border-border/50 pt-4 text-center">
        <BaseButton
          v-if="setting || canTest"
          data-testid="notification-test"
          type="button"
          size="sm"
          :disabled="!canTest && !setting"
          :loading="testing.active"
          @click="testChannel"
          >{{ t('settings.notifications.form.testButton') }}</BaseButton
        >
        <small v-else class="mt-2 block text-xs text-text-secondary">{{
          t('settings.notifications.form.fillRequiredToTest')
        }}</small>
        <small
          v-if="testing.message"
          :class="['mt-2 block text-xs', testing.success ? 'text-success' : 'text-error']"
          >{{ testing.message }}</small
        >
      </div>
    </section>

    <div>
      <label class="mb-2 block text-sm font-medium text-text-secondary">{{
        t('settings.notifications.form.enabledEvents')
      }}</label>
      <div class="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <label
          v-for="event in events"
          :key="event"
          class="flex cursor-pointer select-none items-center text-sm text-foreground"
          ><BaseCheckbox
            :model-value="form.enabledEvents.includes(event)"
            class="mr-2"
            @update:model-value="toggleEvent(event)"
          />{{ t(`settings.notifications.events.${event}`) }}</label
        >
      </div>
    </div>

    <div class="mt-6 flex justify-end space-x-3 border-t border-border pt-5">
      <BaseButton type="button" @click="emit('close')">{{ t('common.cancel') }}</BaseButton
      ><BaseButton type="submit" variant="primary" :disabled="Boolean(headerValidation.error) || testing.active">{{
        t('common.save')
      }}</BaseButton>
    </div>
  </form>
</template>
