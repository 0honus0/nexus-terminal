<script setup lang="ts">
	import UiTransition from './UiTransition.vue';
	import { ref, type VNodeChild } from 'vue';
	import { unrefElement } from '@vueuse/core';
	import {
		DropdownMenuRoot,
		DropdownMenuTrigger,
		DropdownMenuPortal,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator,
	} from 'reka-ui';
	import type { UiDropdownMenuProps } from '../ui-component-types.js';
	import { useTransientOverlay } from '../ui-overlay.js';
	import '../ui-menu.css';
	withDefaults(defineProps<UiDropdownMenuProps>(), { align: 'end', transition: 'fade' });
	const emit = defineEmits<{ select: [id: string] }>();
	defineSlots<{ default: () => VNodeChild }>();
	const open = defineModel<boolean>('open', { default: false });
	const trigger = ref<InstanceType<typeof DropdownMenuTrigger>>();
	const overlay = useTransientOverlay(open);

	const select = (id: string) => overlay.select(unrefElement(trigger), () => emit('select', id));
</script>
<template>
	<DropdownMenuRoot v-model:open="open" :modal="false">
		<DropdownMenuTrigger ref="trigger" as-child :disabled="disabled || !items.length"><slot /></DropdownMenuTrigger>
		<DropdownMenuPortal>
			<UiTransition :preset="transition"
				><DropdownMenuContent
					v-if="open"
					force-mount
					data-ui="dropdown-menu"
					class="ui-menu"
					:align="align"
					:side-offset="5"
					:collision-padding="12"
					@interact-outside="overlay.interactOutside"
					@close-auto-focus="overlay.closeAutoFocus"
				>
					<template v-for="item in items" :key="item.id">
						<DropdownMenuSeparator v-if="item.separatorBefore" class="ui-menu__separator" />
						<DropdownMenuItem
							class="ui-menu__item"
							:data-tone="item.tone ?? 'neutral'"
							:disabled="item.disabled"
							@select="select(item.id)"
						>
							<component :is="item.icon" v-if="item.icon" :size="16" /><span>{{ item.label }}</span>
						</DropdownMenuItem>
					</template>
				</DropdownMenuContent></UiTransition
			>
		</DropdownMenuPortal>
	</DropdownMenuRoot>
</template>
