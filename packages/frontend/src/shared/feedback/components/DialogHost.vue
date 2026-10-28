<script setup lang="ts">
	import { computed, useId } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiConfirmationPanel } from '@/foundation/ui';
	import { useDialogStore } from '../store/dialog.store';

	const store = useDialogStore();
	const checkboxId = useId();
	const { t } = useI18n();

	const title = computed(
		() =>
			store.state.title ||
			(store.state.kind === 'confirm' ? t('feedback.confirmTitle') : t('feedback.alertTitle')),
	);
	const primaryText = computed(
		() => store.state.confirmText || (store.state.kind === 'confirm' ? t('common.confirm') : t('common.ok')),
	);
	const cancelText = computed(() => store.state.cancelText || t('common.cancel'));
	const tone = computed(() => store.state.tone ?? (store.state.destructive ? 'danger' : 'primary'));
	const icon = computed(
		() => store.state.icon ?? (store.state.destructive ? 'fas fa-exclamation-triangle' : 'fas fa-question-circle'),
	);

	const closeFromBackdrop = (): void => {
		if (store.state.loading) return;
		if (store.state.kind === 'alert') store.accept();
		else store.cancel();
	};
</script>

<template>
	<UiConfirmationPanel
		:visible="store.state.visible"
		:z-index="9999"
		:close-on-escape="true"
		:focus-on-open="true"
		:restore-focus="true"
		backdrop-trigger="mousedown"
		:title="title"
		:description="store.state.message"
		:tone="tone"
		:icon="icon"
		@close="closeFromBackdrop"
	>
		<div v-if="store.state.details.length" class="ui-confirmation-panel__details" data-dialog-details>
			<div
				v-for="(detail, index) in store.state.details"
				:key="`${detail.label}-${index}`"
				class="ui-confirmation-panel__detail"
				:data-mono="detail.mono || undefined"
				:data-tone="detail.tone || 'default'"
			>
				<span class="ui-confirmation-panel__detail-label">{{ detail.label }}</span>
				<span class="ui-confirmation-panel__detail-value">{{ detail.value }}</span>
			</div>
		</div>
		<label
			v-if="store.state.checkboxLabel"
			:for="checkboxId"
			class="flex items-center gap-2 text-sm cursor-pointer"
		>
			<UiCheckbox
				:id="checkboxId"
				:model-value="store.state.checkboxChecked"
				:disabled="store.state.loading"
				@update:model-value="store.setCheckboxChecked"
			/>
			<span>{{ store.state.checkboxLabel }}</span>
		</label>
		<template #actions>
			<UiButton
				v-if="store.state.kind === 'confirm'"
				type="button"
				:disabled="store.state.loading"
				appearance="soft"
				@click="store.cancel"
			>
				{{ cancelText }}
			</UiButton>
			<UiButton
				type="button"
				appearance="solid"
				:tone="store.state.destructive ? 'danger' : 'primary'"
				:loading="store.state.loading"
				@click="store.accept"
			>
				{{ primaryText }}
			</UiButton>
		</template>
	</UiConfirmationPanel>
</template>
