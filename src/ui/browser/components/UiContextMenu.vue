<script setup lang="ts">
	import UiTransition from './UiTransition.vue';
	import type { UiContextMenuProps } from '../ui-component-types.js';

	import { ref, type VNodeChild } from 'vue';
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
	defineProps<UiContextMenuProps>();
	const open = defineModel<boolean>('open', { default: false });
	const emit = defineEmits<{ select: [id: string] }>();
	const trigger = ref<InstanceType<typeof ContextMenuTrigger>>();
	const overlay = useTransientOverlay(open);

	const select = (id: string) => overlay.select(unrefElement(trigger), () => emit('select', id));

	defineSlots<{ default: () => VNodeChild }>();
</script>

<template>
	<!-- 右键、键盘菜单键、触屏长按与焦点收尾均交给 Reka；组件只处理样式和选项。 -->
	<ContextMenuRoot v-model:open="open" :modal="false">
		<ContextMenuTrigger ref="trigger" as-child :disabled="disabled"><slot /></ContextMenuTrigger>
		<ContextMenuPortal>
			<UiTransition
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
