<script setup lang="ts">
	import { useId } from 'vue';
	import UiOverlayPanel from './UiOverlayPanel.vue';
	import UiActionGroup from './UiActionGroup.vue';

	withDefaults(
		defineProps<{
			visible: boolean;
			title: string;
			description?: string;
			icon?: string;
			tone?: 'primary' | 'danger' | 'warning';
			zIndex?: number;
			closeOnBackdrop?: boolean;
			closeOnEscape?: boolean;
			focusOnOpen?: boolean;
			restoreFocus?: boolean;
			backdropTrigger?: 'click' | 'mousedown';
		}>(),
		{
			description: '',
			icon: 'fas fa-question-circle',
			tone: 'primary',
			zIndex: 50,
			closeOnBackdrop: true,
			closeOnEscape: false,
			focusOnOpen: false,
			restoreFocus: false,
			backdropTrigger: 'click',
		},
	);
	defineEmits<{ close: [] }>();
	const titleId = useId();
</script>

<template>
	<UiOverlayPanel
		:visible="visible"
		teleport
		:z-index="zIndex"
		:close-on-backdrop="closeOnBackdrop"
		:close-on-escape="closeOnEscape"
		:focus-on-open="focusOnOpen"
		:restore-focus="restoreFocus"
		:backdrop-trigger="backdropTrigger"
		panel-class="ui-form-surface ui-confirmation-panel"
		role="dialog"
		:aria-modal="true"
		:aria-labelledby="titleId"
		@close="$emit('close')"
	>
		<div class="ui-confirmation-panel__body">
			<div class="ui-confirmation-panel__icon" :data-tone="tone"><i :class="icon" aria-hidden="true" /></div>
			<div class="min-w-0 flex-1">
				<h3 :id="titleId" class="ui-confirmation-panel__title">{{ title }}</h3>
				<p v-if="description" class="ui-confirmation-panel__description">{{ description }}</p>
			</div>
		</div>
		<div v-if="$slots.default" class="ui-confirmation-panel__content"><slot /></div>
		<UiActionGroup layout="confirmation"><slot name="actions" /></UiActionGroup>
	</UiOverlayPanel>
</template>
