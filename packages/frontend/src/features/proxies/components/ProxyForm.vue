<script setup lang="ts">
	import { reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { TargetProxyInput } from '@nexus-terminal/shared/targets/proxies/http';
	import {
		UiButton,
		UiCheckbox,
		UiFormActions,
		UiFormField,
		UiInlineNotice,
		UiInput,
		UiSelect,
	} from '@/foundation/ui';
	import { toProxyInput } from '../model/proxy-mapper';
	import type { ProxySummary, ProxyDraft } from '../model/proxy-types';
	const props = defineProps<{ proxy?: ProxySummary | null; loading?: boolean }>();
	const emit = defineEmits<{ submit: [input: TargetProxyInput]; cancel: [] }>();
	const { t } = useI18n();
	const form = reactive<ProxyDraft>({
		name: '',
		type: 'SOCKS5',
		host: '',
		port: 1080,
		username: '',
		password: '',
		clearPassword: false,
	});
	const error = ref('');
	watch(
		() => props.proxy,
		(proxy) => {
			form.name = proxy?.name ?? '';
			form.type = proxy?.type ?? 'SOCKS5';
			form.host = proxy?.host ?? '';
			form.port = proxy?.port ?? 1080;
			form.username = proxy?.username ?? '';
			form.password = '';
			form.clearPassword = false;
			error.value = '';
		},
		{ immediate: true },
	);
	watch(
		() => form.password,
		(value) => {
			if (value) {
				form.clearPassword = false;
			}
		},
	);
	watch(
		() => form.clearPassword,
		(value) => {
			if (value) {
				form.password = '';
			}
		},
	);

	function submit(): void {
		if (props.loading) {
			return;
		}
		try {
			error.value = '';
			emit('submit', toProxyInput(form));
		} catch {
			error.value = t('proxies.failures.invalid_input');
		}
	}
</script>
<template>
	<form class="flex min-h-0 flex-1 flex-col text-foreground" @submit.prevent="submit">
		<h3 class="shrink-0 pb-4 text-lg font-semibold">
			{{ proxy ? t('proxies.form.titleEdit') : t('proxies.form.title') }}
		</h3>
		<fieldset
			class="m-0 min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain border-0 p-0 pr-1 sm:pr-3"
			:disabled="loading"
		>
			<section class="ui-form-section space-y-4">
				<h4>{{ t('proxies.form.sectionBasic') }}</h4>
				<UiFormField :label="t('proxies.form.name')"
					><UiInput id="proxy-name" v-model="form.name" required
				/></UiFormField>
				<UiFormField :label="t('proxies.form.type')"
					><UiSelect id="proxy-type" v-model="form.type" match-trigger-width
						><option value="SOCKS5">SOCKS5</option>
						<option value="HTTP">HTTP</option></UiSelect
					></UiFormField
				>
			</section>
			<section class="ui-form-section space-y-4">
				<h4>{{ t('proxies.form.sectionEndpoint') }}</h4>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
					<UiFormField :label="t('proxies.form.host')"
						><UiInput id="proxy-host" v-model="form.host" required
					/></UiFormField>
					<UiFormField :label="t('proxies.form.port')"
						><UiInput id="proxy-port" v-model="form.port" type="number" min="1" max="65535" required
					/></UiFormField>
				</div>
			</section>
			<section class="ui-form-section space-y-4">
				<h4>{{ t('proxies.form.sectionCredentials') }}</h4>
				<UiFormField :label="`${t('proxies.form.username')} (${t('proxies.form.optional')})`"
					><UiInput id="proxy-username" v-model="form.username"
				/></UiFormField>
				<UiFormField :label="`${t('proxies.form.password')} (${t('proxies.form.optional')})`"
					><UiInput id="proxy-password" v-model="form.password" type="password" autocomplete="new-password" />
					<p v-if="proxy" class="mt-1 text-xs text-text-secondary">
						{{ t('proxies.form.passwordUpdateNote') }}
					</p>
					<label
						v-if="proxy"
						class="mt-2 flex cursor-pointer select-none items-center gap-2 text-sm text-text-secondary"
						><UiCheckbox v-model="form.clearPassword" />{{ t('proxies.form.clearStoredPassword') }}</label
					></UiFormField
				>
			</section>
			<UiInlineNotice v-if="error" tone="danger">
				{{ error }}
			</UiInlineNotice>
		</fieldset>
		<UiFormActions class="mt-4 shrink-0 border-t border-border pt-4">
			<UiButton type="button" :disabled="loading" @click="emit('cancel')">{{
				t('proxies.form.cancel')
			}}</UiButton>
			<UiButton type="submit" appearance="solid" tone="primary" :loading="loading">{{
				t('common.save')
			}}</UiButton>
		</UiFormActions>
	</form>
</template>
