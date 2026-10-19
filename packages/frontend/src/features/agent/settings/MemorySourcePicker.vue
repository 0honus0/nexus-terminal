<script setup lang="ts">
	import { onActivated, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { listManagedMemories } from '../api/memory-management-api';
	import type { ManagedMemory } from '../model/memory-types';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';

	const props = defineProps<{ appId: string; disabled: boolean }>();
	const emit = defineEmits<{ select: [id: string] }>();
	const { t } = useI18n();
	const items = ref<ManagedMemory[]>([]);
	const nextOffset = ref<number | null>(null);
	const offset = ref(0);
	const operation = useAgentManagementOperation(() => {
		items.value = [];
		nextOffset.value = null;
		offset.value = 0;
	});

	async function load(pageOffset = 0): Promise<void> {
		if (props.disabled) {
			return;
		}
		await operation.execute(
			(signal) => listManagedMemories(props.appId, 'published', pageOffset, signal),
			(page) => {
				items.value = page.items;
				offset.value = pageOffset;
				nextOffset.value = page.nextOffset;
			},
			{ write: false },
		);
	}

	function initial(): void {
		if (operation.refreshRequired.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
</script>
<template>
	<fieldset :disabled="disabled || operation.busy.value" class="space-y-2">
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<div class="flex flex-wrap gap-2">
			<UiButton type="button" @click="load()">{{ t('agent.settings.memoryManagement.readSources') }}</UiButton>
			<UiButton type="button" :disabled="offset === 0" @click="load(Math.max(0, offset - 20))">{{
				t('agent.settings.memoryManagement.previous')
			}}</UiButton>
			<UiButton type="button" :disabled="nextOffset === null" @click="nextOffset !== null && load(nextOffset)">{{
				t('agent.settings.memoryManagement.next')
			}}</UiButton>
		</div>
		<div class="max-h-64 space-y-2 overflow-y-auto">
			<UiButton v-for="memory in items" :key="memory.id" type="button" @click="emit('select', memory.id)"
				>{{ memory.content.slice(0, 120) }} · v{{ memory.version }}</UiButton
			>
		</div>
	</fieldset>
</template>
