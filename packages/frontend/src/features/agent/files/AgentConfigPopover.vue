<script lang="ts">
	let activePopoverCloser: (() => void) | null = null;
</script>

<script setup lang="ts">
	import { onBeforeUnmount, ref } from 'vue';
	import { UiPopover } from '@/foundation/ui';

	const props = withDefaults(
		defineProps<{
			ariaLabel: string;
			title?: string;
			align?: 'left' | 'right';
			panelClass?: string;
			triggerClass?: string;
			triggerVariant?: 'default' | 'square';
			disabled?: boolean;
		}>(),
		{ title: '', align: 'left', panelClass: '', triggerClass: '', triggerVariant: 'default', disabled: false },
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
		placement="top"
		align="center"
		boundary-selector=".agent-hub-window"
		portal-marker
		:panel-class="`rounded-2xl p-3 ${props.panelClass}`"
		@open-change="onOpenChange"
	>
		<template #trigger-control="{ open: expanded }">
			<button
				type="button"
				class="agent-config-summary flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors duration-150 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
				:class="[
					props.triggerVariant === 'square' ? 'agent-config-trigger-square' : '',
					expanded
						? 'border-border/70 bg-header/90 text-foreground shadow-xs'
						: 'border-transparent bg-transparent text-text-secondary hover:border-border/50 hover:bg-header/70 hover:text-foreground',
					props.triggerClass,
				]"
				:disabled="props.disabled"
				:aria-label="props.ariaLabel"
				:title="props.title || undefined"
			>
				<slot name="trigger" :open="expanded" />
			</button>
		</template>
		<template #panel="{ close: closePanel }">
			<slot name="panel" :close="(restoreFocus = true) => closePanel(restoreFocus)" />
		</template>
	</UiPopover>
</template>

<style scoped>
	.agent-config-summary {
		font-size: 11px;
		line-height: 1.25;
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
			height: 28px;
			gap: 4px;
			padding-inline: 6px;
			font-size: 11px;
			line-height: 1.25;
		}
	}

	@container agent-hub-window (max-width: 760px) {
		.agent-config-summary {
			min-width: 28px;
			height: 28px;
			gap: 3px;
			padding-inline: 6px;
			font-size: 11px;
			line-height: 1.25;
		}
	}
</style>
