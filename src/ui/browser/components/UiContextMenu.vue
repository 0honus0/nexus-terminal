<script setup lang="ts">
	import UiTransition from './UiTransition.vue';
	import type { UiContextMenuProps } from '../ui-component-types.js';

	import { ref, watch, type VNodeChild } from 'vue';
	import { unrefElement } from '@vueuse/core';
	import { useTransientOverlay } from '../ui-overlay.js';
	import '../ui-menu.css';
	import {
		ContextMenuRoot,
		ContextMenuTrigger,
		ContextMenuPortal,
		ContextMenuContent,
		ContextMenuItem,
		ContextMenuSeparator,
	} from 'reka-ui';
	const props = defineProps<UiContextMenuProps>();
	const open = defineModel<boolean>('open', { default: false });
	const emit = defineEmits<{ select: [id: string] }>();
	const trigger = ref<InstanceType<typeof ContextMenuTrigger>>();
	const overlay = useTransientOverlay(open);

	let pressing: number | undefined;
	let longPress: number | undefined;

	watch(
		open,
		(value) => {
			if (value) longPress = pressing;
		},
		{ flush: 'sync' },
	);

	function startPress(event: PointerEvent) {
		pressing = undefined;
		longPress = undefined;
		if (!props.disabled && event.isPrimary && event.button === 0 && ['touch', 'pen'].includes(event.pointerType))
			pressing = event.pointerId;
	}

	function finishPress(event: PointerEvent) {
		if (pressing === event.pointerId) pressing = undefined;
		if (event.type === 'pointercancel' && longPress === event.pointerId) longPress = undefined;
	}

	function preventReleaseFocus(event: MouseEvent) {
		if (longPress !== undefined) event.preventDefault();
	}

	function suppressReleaseClick(event: MouseEvent) {
		if (longPress === undefined || !event.detail) return;
		if (event instanceof PointerEvent && event.pointerType && event.pointerId !== longPress) return;
		longPress = undefined;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	const select = (id: string) => overlay.select(unrefElement(trigger), () => emit('select', id));

	defineSlots<{ default: () => VNodeChild }>();
</script>

<template>
	<!-- Reka 打开菜单，松手生成的鼠标事件不能抢走焦点或触发点击。 -->
	<ContextMenuRoot v-model:open="open" :modal="false">
		<ContextMenuTrigger
			ref="trigger"
			as-child
			:disabled="disabled"
			@pointerdown.capture="startPress"
			@pointerup.capture="finishPress"
			@pointercancel.capture="finishPress"
			@mousedown.capture="preventReleaseFocus"
			@click.capture="suppressReleaseClick"
			><slot
		/></ContextMenuTrigger>
		<ContextMenuPortal>
			<UiTransition preset="context-menu"
				><ContextMenuContent
					v-if="open"
					force-mount
					data-ui="context-menu"
					class="ui-menu"
					@interact-outside="overlay.interactOutside"
					@pointerup.capture="(event: PointerEvent) => event.button !== 0 && event.preventDefault()"
					@close-auto-focus="overlay.closeAutoFocus"
					:side-offset="8"
					:collision-padding="12"
				>
					<template v-for="item in items" :key="item.id">
						<ContextMenuSeparator v-if="item.separatorBefore" class="ui-menu__separator" />
						<ContextMenuItem
							class="ui-menu__item"
							:data-tone="item.tone ?? 'neutral'"
							:disabled="item.disabled"
							@select="select(item.id)"
						>
							<component :is="item.icon" v-if="item.icon" :size="16" /><span>{{ item.label }}</span>
						</ContextMenuItem>
					</template>
				</ContextMenuContent></UiTransition
			>
		</ContextMenuPortal>
	</ContextMenuRoot>
</template>
