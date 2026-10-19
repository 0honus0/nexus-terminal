<script setup lang="ts">
	import { computed, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { OPERATION_EVENTS, type OperationEvent } from '@nexus-terminal/shared/operations/values';
	import {
		NOTIFICATION_MAX_HEADERS,
		type NotificationChannel,
	} from '@nexus-terminal/shared/operations/notifications/values';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiSelect, UiTextarea } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { useNotificationsStore } from '../store/notifications.store';
	import { notificationFailureKey } from '../model/notification-failure';
	import type {
		NotificationSetting,
		NotificationChange,
		NotificationConfigChange,
		NotificationSecret,
	} from '../model/notification-types';

	interface HeaderDraft {
		name: string;
		action: NotificationSecret['action'];
		value: string;
		hasValue: boolean;
	}

	const props = defineProps<{ visible: boolean; setting: NotificationSetting | null }>();
	const emit = defineEmits<{ close: []; save: [input: NotificationChange] }>();
	const { t, te } = useI18n();
	const store = useNotificationsStore();
	const channel = ref<NotificationChannel>('webhook');
	const method = ref<'GET' | 'POST' | 'PUT'>('POST');
	const events = ref<OperationEvent[]>([]);
	const headers = ref<HeaderDraft[]>([]);
	const secretAction = ref<NotificationSecret['action']>('clear');
	const form = reactive({
		name: '',
		enabled: true,
		url: '',
		bodyTemplate: '',
		to: '',
		from: '',
		host: '',
		port: 587,
		secure: true,
		username: '',
		secret: '',
		origin: 'https://api.telegram.org',
		chatId: '',
	});
	const message = ref('');
	const view = useAuthenticatedViewScope({
		available: () => props.visible,

		onRevoke: clearSecrets,
	});

	function clearSecrets(): void {
		form.secret = '';
		headers.value = [];
		message.value = '';
	}

	function resetDraft(): void {
		const setting = props.setting;
		const config = setting?.config;
		channel.value = config?.kind ?? 'webhook';
		events.value = setting?.events.map((event) => event) ?? [];
		method.value = config?.kind === 'webhook' ? config.method : 'POST';
		secretAction.value = setting ? 'keep' : 'clear';
		Object.assign(form, {
			name: setting?.name ?? '',
			enabled: setting?.enabled ?? true,
			url: config?.kind === 'webhook' ? config.url : '',
			bodyTemplate: config?.bodyTemplate ?? '',
			to: config?.kind === 'email' ? config.to : '',
			from: config?.kind === 'email' ? config.from : '',
			host: config?.kind === 'email' ? config.host : '',
			port: config?.kind === 'email' ? config.port : 587,
			secure: config?.kind === 'email' ? config.secure : true,
			username: config?.kind === 'email' ? config.username : '',
			secret: '',
			origin: config?.kind === 'telegram' ? config.origin : 'https://api.telegram.org',
			chatId: config?.kind === 'telegram' ? config.chatId : '',
		});
		headers.value =
			config?.kind === 'webhook'
				? config.headers.map((header) => ({
						name: header.name,
						hasValue: header.hasValue,
						action: 'keep',
						value: '',
					}))
				: [];
		message.value = '';
	}

	watch(
		() => props.visible,
		(visible) => {
			if (visible) {
				resetDraft();
			}
		},
		{ immediate: true },
	);
	watch(secretAction, () => {
		form.secret = '';
	});
	watch(channel, () => {
		form.secret = '';
		headers.value = [];
		secretAction.value = 'clear';
	});

	function secret(action: NotificationSecret['action'], value: string): NotificationSecret {
		if (action === 'replace') {
			return { action: 'replace', value };
		}
		return action === 'keep' ? { action: 'keep' } : { action: 'clear' };
	}

	function buildConfig(): NotificationConfigChange {
		const bodyTemplate = form.bodyTemplate === '' ? null : form.bodyTemplate;
		if (channel.value === 'webhook') {
			return {
				kind: 'webhook',
				url: form.url,
				method: method.value,
				headers: headers.value.map((header) => ({
					name: header.name,
					value: secret(header.action, header.value),
				})),
				bodyTemplate,
			};
		}
		if (channel.value === 'email') {
			return {
				kind: 'email',
				to: form.to,
				from: form.from,
				host: form.host,
				port: Number(form.port),
				secure: form.secure,
				username: form.username,
				password: secret(secretAction.value, form.secret),
				bodyTemplate,
			};
		}
		return {
			kind: 'telegram',
			origin: form.origin,
			chatId: form.chatId,
			botToken: secret(secretAction.value, form.secret),
			bodyTemplate,
		};
	}

	function submit(): void {
		if (!store.loading && !store.needsRefresh) {
			emit('save', {
				name: form.name.trim(),
				enabled: form.enabled,
				events: events.value.map((event) => event),
				config: buildConfig(),
			});
		}
	}

	async function testChannel(): Promise<void> {
		const signal = view.capture();
		if (signal.aborted || store.loading || store.needsRefresh) {
			return;
		}
		message.value = '';
		try {
			const result = props.setting
				? await store.testSaved(props.setting.id, signal)
				: await store.testUnsaved(buildConfig(), signal);
			if (view.isCurrent(signal)) {
				message.value = t('settings.notifications.deliveryStatus.' + result.status);
			}
		} catch (cause) {
			if (view.isCurrent(signal)) {
				message.value = t(notificationFailureKey(cause));
			}
		}
	}

	const actions = computed(() => [
		{ value: 'keep', label: t('settings.notifications.form.keepSecret') },
		{ value: 'clear', label: t('settings.notifications.form.clearSecret') },
		{ value: 'replace', label: t('settings.notifications.form.replaceSecret') },
	]);

	const eventLabel = (event: OperationEvent) =>
		te('settings.notifications.events.' + event) ? t('settings.notifications.events.' + event) : event;

	function toggleEvent(event: OperationEvent): void {
		events.value = events.value.includes(event)
			? events.value.filter((value) => value !== event)
			: [...events.value, event];
	}
</script>

<template>
	<form v-if="visible" class="space-y-6 text-foreground" @submit.prevent="submit">
		<h3 class="text-lg font-semibold">
			{{ t(setting ? 'settings.notifications.form.editTitle' : 'settings.notifications.form.addTitle') }}
		</h3>
		<fieldset :disabled="store.loading || store.needsRefresh" class="space-y-4">
			<UiFormField :label="t('settings.notifications.form.name')" for-id="setting-name">
				<UiInput id="setting-name" v-model="form.name" required />
			</UiFormField>
			<label class="flex gap-2"><UiCheckbox v-model="form.enabled" />{{ t('common.enabled') }}</label>
			<UiFormField :label="t('settings.notifications.form.channelType')" for-id="setting-channel-type">
				<UiSelect id="setting-channel-type" v-model="channel" :disabled="Boolean(setting)">
					<option value="webhook">{{ t('settings.notifications.types.webhook') }}</option>
					<option value="email">{{ t('settings.notifications.types.email') }}</option>
					<option value="telegram">{{ t('settings.notifications.types.telegram') }}</option>
				</UiSelect>
			</UiFormField>
			<template v-if="channel === 'webhook'">
				<UiFormField label="URL" for-id="webhook-url"
					><UiInput id="webhook-url" v-model="form.url" type="url" required
				/></UiFormField>
				<UiFormField :label="t('settings.notifications.form.webhookMethod')" for-id="webhook-method">
					<UiSelect id="webhook-method" v-model="method"
						><option>POST</option>
						<option>GET</option>
						<option>PUT</option></UiSelect
					>
				</UiFormField>
				<div class="space-y-3">
					<h4>{{ t('settings.notifications.form.webhookHeaders') }}</h4>
					<div v-for="(header, index) in headers" :key="index" class="grid gap-2 sm:grid-cols-4">
						<UiInput
							v-model="header.name"
							:aria-label="t('settings.notifications.form.headerName')"
							required
						/>
						<UiSelect
							v-model="header.action"
							:options="actions"
							:aria-label="t('settings.notifications.form.secretAction')"
							@update:model-value="header.value = ''"
						/>
						<UiInput
							v-if="header.action === 'replace'"
							v-model="header.value"
							type="password"
							autocomplete="new-password"
							:aria-label="t('settings.notifications.form.headerValue')"
							required
						/>
						<span v-else>{{
							t(
								header.hasValue
									? 'settings.notifications.form.secretPresent'
									: 'settings.notifications.form.secretAbsent',
							)
						}}</span>
						<UiButton type="button" @click="headers.splice(index, 1)">{{ t('common.delete') }}</UiButton>
					</div>
					<UiButton
						type="button"
						:disabled="headers.length >= NOTIFICATION_MAX_HEADERS"
						@click="headers.push({ name: '', action: 'replace', value: '', hasValue: false })"
						>{{ t('settings.notifications.form.addHeader') }}</UiButton
					>
				</div>
			</template>
			<template v-else-if="channel === 'email'">
				<UiFormField :label="t('settings.notifications.form.emailTo')" for-id="notification-to"
					><UiInput id="notification-to" v-model="form.to" type="email" multiple required
				/></UiFormField>
				<UiFormField :label="t('settings.notifications.form.smtpFrom')" for-id="notification-from"
					><UiInput id="notification-from" v-model="form.from" type="email" required
				/></UiFormField>
				<UiFormField :label="t('settings.notifications.form.smtpHost')" for-id="notification-host"
					><UiInput id="notification-host" v-model="form.host" required
				/></UiFormField>
				<UiFormField :label="t('settings.notifications.form.smtpPort')" for-id="notification-port"
					><UiInput id="notification-port" v-model="form.port" type="number" min="1" max="65535" required
				/></UiFormField>
				<label class="flex gap-2"
					><UiCheckbox v-model="form.secure" />{{ t('settings.notifications.form.smtpSecure') }}</label
				>
				<UiFormField :label="t('settings.notifications.form.smtpUser')" for-id="notification-user"
					><UiInput id="notification-user" v-model="form.username"
				/></UiFormField>
			</template>
			<template v-else>
				<UiFormField :label="t('settings.notifications.form.telegramCustomDomain')" for-id="notification-origin"
					><UiInput id="notification-origin" v-model="form.origin" type="url" required
				/></UiFormField>
				<UiFormField :label="t('settings.notifications.form.telegramChatId')" for-id="notification-chat"
					><UiInput id="notification-chat" v-model="form.chatId" required
				/></UiFormField>
			</template>
			<template v-if="channel !== 'webhook'">
				<UiFormField
					:label="
						t(
							channel === 'email'
								? 'settings.notifications.form.smtpPass'
								: 'settings.notifications.form.telegramToken',
						)
					"
					for-id="notification-secret-action"
				>
					<UiSelect id="notification-secret-action" v-model="secretAction" :options="actions" />
				</UiFormField>
				<UiInput
					v-if="secretAction === 'replace'"
					v-model="form.secret"
					type="password"
					autocomplete="new-password"
					:aria-label="t('settings.notifications.form.headerValue')"
					required
				/>
				<p v-else class="text-sm text-text-secondary">{{ t('settings.notifications.form.secretHint') }}</p>
			</template>
			<UiFormField :label="t('settings.notifications.form.webhookBodyTemplate')" for-id="notification-template">
				<UiTextarea id="notification-template" v-model="form.bodyTemplate" :min-rows="3" />
				<p class="text-xs text-text-secondary">
					{{ t('settings.notifications.form.templateHelp') }} {event}, {subjectId}, {time}
				</p>
			</UiFormField>
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				<label v-for="event in OPERATION_EVENTS" :key="event" class="flex gap-2 text-sm">
					<UiCheckbox :model-value="events.includes(event)" @update:model-value="toggleEvent(event)" />{{
						eventLabel(event)
					}}
				</label>
			</div>
			<UiButton type="button" @click="testChannel">{{
				t(setting ? 'settings.notifications.form.testSaved' : 'settings.notifications.form.testButton')
			}}</UiButton>
		</fieldset>
		<p v-if="message" role="status">{{ message }}</p>
		<div class="flex justify-end gap-3">
			<UiButton type="button" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
			<UiButton type="submit" appearance="solid" :disabled="store.loading || store.needsRefresh">{{
				t('common.save')
			}}</UiButton>
		</div>
	</form>
</template>
