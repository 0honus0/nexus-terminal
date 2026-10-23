<script setup lang="ts">
	import { computed, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormActions, UiFormField, UiInlineLoading, UiInput, UiModal } from '@/foundation/ui';
	import { isToolPassword } from '@nexus-terminal/shared/remote/tools/values';
	import type { ToolOffer } from '../model/tool-types';

	const props = defineProps<{ offer: ToolOffer | null; busy: boolean; targetName?: string }>();
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
		if (props.busy || invalid.value) {
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
					t('remoteTools.confirm', {
						target: targetName || String(offer.targetId),
						tools: offer.missing.join(', '),
						manager: offer.manager,
					})
				}}
			</p>
			<p class="text-sm text-text-secondary">{{ t('remoteTools.notice') }}</p>
			<UiFormField v-if="needsPassword && !busy" :label="t('remoteTools.password')" :for-id="passwordId">
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
				<UiButton :disabled="busy" @click="emit('cancel')">{{ t('common.cancel') }}</UiButton>
				<UiButton type="submit" tone="primary" appearance="solid" :disabled="busy || invalid" :loading="busy">{{
					t('remoteTools.install')
				}}</UiButton>
			</UiFormActions>
		</form>
	</UiModal>
</template>
