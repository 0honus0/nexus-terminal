import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
import type { AgentMemoryDecision, AgentMemoryStatus } from '@nexus-terminal/shared/agent/memory/values';
import { getManagedMemory, listManagedMemories, reviewManagedMemory } from '../api/memory-management-api';
import type { ManagedMemory } from '../model/memory-types';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function useAppMemory(appId: string) {
	const items = ref<ManagedMemory[]>([]);
	const status = ref<AgentMemoryStatus | 'all'>('all');
	const offset = ref(0);
	const nextOffset = ref<number | null>(null);
	const original = ref<ManagedMemory | null>(null);
	const reviewContent = ref('');
	const needsReload = ref(true);
	let listRevision = 0;
	const operation = useAgentManagementOperation(() => {
		items.value = [];
		status.value = 'all';
		offset.value = 0;
		nextOffset.value = null;
		original.value = null;
		reviewContent.value = '';
		needsReload.value = true;
	});
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || needsReload.value);

	async function load(pageOffset = 0): Promise<void> {
		if (operation.busy.value) {
			return;
		}
		needsReload.value = true;
		const filter = status.value;
		const revision = listRevision;
		await operation.execute(
			(signal) => listManagedMemories(appId, filter, pageOffset, signal),
			(page) => {
				if (revision !== listRevision) {
					return;
				}
				items.value = page.items;
				offset.value = pageOffset;
				nextOffset.value = page.nextOffset;
				needsReload.value = false;
				original.value = null;
				reviewContent.value = '';
			},
			{ write: false },
		);
	}

	function invalidate(): void {
		listRevision += 1;
		needsReload.value = true;
	}

	async function edit(memory: ManagedMemory): Promise<void> {
		if (blocked.value) {
			return;
		}
		await operation.execute(
			(signal) => getManagedMemory(appId, memory.id, signal),
			(value) => {
				original.value = value;
				reviewContent.value = value.content;
			},
			{ write: false },
		);
	}

	async function review(decision: AgentMemoryDecision): Promise<void> {
		if (blocked.value || original.value === null) {
			return;
		}
		const baseline = structuredClone(toRaw(original.value));
		const content = decision === 'publish' ? reviewContent.value : null;
		await operation.execute(
			(signal) => reviewManagedMemory(appId, baseline, decision, content, signal),
			() => {
				original.value = null;
				reviewContent.value = '';
				needsReload.value = true;
			},
			{ write: true },
		);
	}

	function initial(): void {
		if (needsReload.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
	return {
		items,
		status,
		offset,
		nextOffset,
		original,
		reviewContent,
		needsReload,
		operation,
		blocked,
		load,
		edit,
		review,
		invalidate,
	};
}
