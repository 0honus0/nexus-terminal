<script setup lang="ts">
	import { computed, ref, useId, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiConfirmationPanel } from '@/foundation/ui';
	import type { RemoteDesktopCertificate } from '../model/remote-desktop-types';

	const props = defineProps<{ certificate: RemoteDesktopCertificate; teleport: boolean }>();
	defineEmits<{ cancel: []; approve: [choice: { remember: boolean }] }>();
	const { t, locale } = useI18n();
	const remember = ref(false);
	const checkboxId = useId();
	watch(
		() => props.certificate,
		() => {
			remember.value = false;
		},
	);
	const details = computed(() => {
		const certificate = props.certificate;

		const format = (time: number) => new Date(time).toLocaleString(locale.value);

		return [
			{
				label: t('remoteDesktopModal.certificate.target'),
				value: `${certificate.host}:${certificate.port}`,
				mono: false,
			},
			{ label: t('remoteDesktopModal.certificate.subject'), value: certificate.subject || '—', mono: false },
			{ label: t('remoteDesktopModal.certificate.issuer'), value: certificate.issuer || '—', mono: false },
			{
				label: t('remoteDesktopModal.certificate.validity'),
				value: `${format(certificate.validFrom)} – ${format(certificate.validTo)}`,
				mono: false,
			},
			{ label: 'SHA-256', value: certificate.fingerprint, mono: true },
			...(certificate.previousFingerprint
				? [
						{
							label: t('remoteDesktopModal.certificate.previous'),
							value: certificate.previousFingerprint,
							mono: true,
						},
					]
				: []),
		];
	});
</script>

<template>
	<UiConfirmationPanel
		visible
		:teleport="teleport"
		:title="t('remoteDesktopModal.certificate.title')"
		:description="t('remoteDesktopModal.certificate.reasons.' + certificate.reason)"
		icon="fas fa-shield-halved"
		tone="warning"
		:z-index="1200"
		:close-on-backdrop="false"
		close-on-escape
		focus-on-open
		data-rdp-certificate
		@close="$emit('cancel')"
	>
		<div class="ui-confirmation-panel__details">
			<div v-for="item in details" :key="item.label" class="ui-confirmation-panel__detail" :data-mono="item.mono">
				<span class="ui-confirmation-panel__detail-label">{{ item.label }}</span>
				<span class="ui-confirmation-panel__detail-value">{{ item.value }}</span>
			</div>
		</div>
		<label :for="checkboxId" class="mt-4 flex cursor-pointer items-start gap-2 text-sm">
			<UiCheckbox :id="checkboxId" v-model="remember" class="mt-0.5 shrink-0" />
			<span>{{ t('remoteDesktopModal.certificate.remember') }}</span>
		</label>
		<template #actions>
			<UiButton @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
			<UiButton appearance="solid" tone="warning" @click="$emit('approve', { remember })">
				{{ t('remoteDesktopModal.certificate.connect') }}
			</UiButton>
		</template>
	</UiConfirmationPanel>
</template>
