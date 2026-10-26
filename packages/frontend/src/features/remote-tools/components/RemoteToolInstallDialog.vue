<script setup lang="ts">
	import { computed, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormActions, UiFormField, UiInlineLoading, UiInput, UiModal } from '@/foundation/ui';
	import { isToolPassword } from '@nexus-terminal/shared/remote/tools/values';
	import type { ToolOffer } from '../model/tool-types';

	const props = defineProps<{
		offer: ToolOffer | null;
		busy: boolean;
		targetName?: string;
		allowFallback?: boolean;
	}>();
	const emit = defineEmits<{ approve: [password?: string]; cancel: [] }>();
	const { t } = useI18n();
	const password = ref('');
	const passwordId = useId();
	const needsPassword = computed(() => props.offer?.privilege === 'password');
	const invalid = computed(() => needsPassword.value && !isToolPassword(password.value));
	onDeactivated(() => {
		password.value = '';
	});
	onBeforeUnmount(() => {
		password.value = '';
	});
	watch(
		() => props.offer,
		() => {
			password.value = '';
		},
		{ flush: 'sync' },
	);
	watch(
		() => props.busy,
		() => {
			password.value = '';
		},
		{ flush: 'sync' },
	);

	function approve(): void {
		if (props.busy || invalid.value || !props.offer?.planId) {
			return;
		}
		const value = needsPassword.value ? password.value : undefined;
		password.value = '';
		emit('approve', value);
	}
</script>

<template>
	<UiModal
		:visible="offer !== null"
		:title="t('remoteTools.title')"
		:z-index="95"
		:close-on-backdrop="!busy"
		:close-on-escape="!busy"
		focus-on-open
		restore-focus
		@close="emit('cancel')"
	>
		<form v-if="offer" class="space-y-4" @submit.prevent="approve">
			<p class="break-words">
				{{
					t(offer.planId ? 'remoteTools.confirm' : 'remoteTools.unavailableConfirm', {
						target: targetName || String(offer.targetId),
						tools: offer.missing.join(', '),
						manager: offer.manager,
					})
				}}
			</p>
			<p class="text-sm text-text-secondary">{{ t('remoteTools.notice') }}</p>
			<p v-if="allowFallback" class="text-sm text-text-secondary">{{ t('remoteTools.fallbackNotice') }}</p>
			<UiFormField
				v-if="needsPassword && offer.planId && !busy"
				:label="t('remoteTools.password')"
				:for-id="passwordId"
			>
				<UiInput
					:id="passwordId"
					v-model="password"
					type="password"
					autocomplete="off"
					:aria-label="t('remoteTools.password')"
				/>
			</UiFormField>
			<UiInlineLoading v-if="busy" :label="t('remoteTools.installing')" />
			<UiFormActions>
				<UiButton :disabled="busy" @click="emit('cancel')">{{
					allowFallback ? t('remoteTools.skipInstall') : t('common.cancel')
				}}</UiButton>
				<UiButton
					type="submit"
					tone="primary"
					appearance="solid"
					:disabled="busy || invalid || !offer.planId"
					:loading="busy"
					>{{ t('remoteTools.install') }}</UiButton
				>
			</UiFormActions>
		</form>
	</UiModal>
</template>
