<script lang="ts">
	let activePopoverCloser: (() => void) | null = null;
</script>

<script setup lang="ts">
	import { onBeforeUnmount, ref } from 'vue';
	import { UiButton, UiPopover } from '@/foundation/ui';
	import type { UiAppearance } from '@/foundation/ui';
	import type { ReferenceElement } from 'reka-ui';

	const props = withDefaults(
		defineProps<{
			ariaLabel: string;
			title?: string;
			align?: 'left' | 'right';
			panelClass?: string;
			triggerClass?: string;
			triggerAppearance?: UiAppearance;
			triggerSelected?: boolean;
			triggerVariant?: 'default' | 'square';
			disabled?: boolean;
			anchor?: ReferenceElement;
		}>(),
		{
			title: '',
			align: 'left',
			panelClass: '',
			triggerClass: '',
			triggerAppearance: 'ghost',
			triggerSelected: false,
			triggerVariant: 'default',
			disabled: false,
		},
	);
	const emit = defineEmits<{ 'open-change': [open: boolean] }>();
	const open = ref(false);

	const close = (): void => {
		if (!open.value) return;
		open.value = false;
		emit('open-change', false);
		if (activePopoverCloser === close) activePopoverCloser = null;
	};

	const onOpenChange = (value: boolean): void => {
		if (value) {
			if (activePopoverCloser && activePopoverCloser !== close) activePopoverCloser();
			activePopoverCloser = close;
		} else if (activePopoverCloser === close) activePopoverCloser = null;
		emit('open-change', value);
	};

	function show(): void {
		if (props.disabled || open.value) return;
		open.value = true;
		onOpenChange(true);
	}

	defineExpose({ open: show, close });

	onBeforeUnmount(() => {
		if (activePopoverCloser === close) activePopoverCloser = null;
	});
</script>

<template>
	<UiPopover
		v-model:open="open"
		:ariaLabel="props.ariaLabel"
		:title="props.title"
		:disabled="props.disabled"
		:anchor="props.anchor"
		placement="top"
		align="center"
		boundary-selector=".agent-hub-window"
		panel-marker-attribute="data-agent-hub-portal"
		:panel-class="`rounded-2xl p-3 ${props.panelClass}`"
		@open-change="onOpenChange"
	>
		<template #trigger-control="{ open: expanded }">
			<UiButton
				:appearance="expanded ? 'soft' : props.triggerAppearance"
				density="compact"
				:icon-only="props.triggerVariant === 'square'"
				class="agent-config-summary"
				:class="[
					props.triggerVariant === 'square' ? 'agent-config-trigger-square' : '',
					props.triggerSelected ? 'agent-config-summary--selected' : '',
					props.triggerClass,
				]"
				:disabled="props.disabled"
				:aria-label="props.ariaLabel"
				:title="props.title || undefined"
			>
				<slot name="trigger" :open="expanded" />
			</UiButton>
		</template>
		<template #panel="{ close: closePanel }">
			<slot name="panel" :close="(restoreFocus = true) => closePanel(restoreFocus)" />
		</template>
	</UiPopover>
</template>

<style scoped>
	.agent-config-summary {
		min-width: var(--agent-config-trigger-min-width, var(--agent-config-hub-min-width, var(--ui-control-height)));
		height: var(--agent-config-trigger-height, var(--agent-config-hub-height, var(--ui-control-height)));
		gap: var(--agent-config-trigger-gap, var(--agent-config-hub-gap, var(--ui-control-gap)));
		padding-inline: var(
			--agent-config-trigger-padding-inline,
			var(--agent-config-hub-padding-inline, var(--ui-control-padding-inline))
		);
		justify-content: var(--agent-config-trigger-justify-content, center);
		font-size: 11px;
		line-height: 1.25;
	}

	.agent-config-summary--selected {
		border-color: color-mix(in srgb, var(--link-active-color) 55%, var(--border-color));
		background-color: color-mix(in srgb, var(--link-active-color) 10%, var(--header-bg-color));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--link-active-color) 14%, transparent);
	}

	.agent-config-summary.agent-config-trigger-square {
		width: 28px;
		min-width: 28px;
		height: 28px;
		padding-inline: 0;
		justify-content: center;
		gap: 0;
	}

	@container agent-hub-window (max-width: 1040px) {
		.agent-config-summary {
			--agent-config-hub-height: 28px;
			--agent-config-hub-gap: 4px;
			--agent-config-hub-padding-inline: 6px;
		}
	}

	@container agent-hub-window (max-width: 760px) {
		.agent-config-summary {
			--agent-config-hub-min-width: 28px;
			--agent-config-hub-gap: 3px;
		}
	}
	@container agent-hub-window (max-width: 760px) {
		.agent-config-summary,
		.agent-config-summary.agent-config-trigger-square {
			height: 44px;
		}
	}

	@media (pointer: coarse) {
		.agent-config-summary,
		.agent-config-summary.agent-config-trigger-square {
			height: 44px;
		}
	}
</style>
