import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
import type { AgentMemoryDecision, AgentMemoryStatus } from '@nexus-terminal/shared/agent/memory/values';
import {
	getManagedMemory,
	listManagedMemories,
	proposeManagedMemory,
	reviewManagedMemory,
} from '../api/memory-management-api';
import type { ManagedMemory, MemoryProposalDraft } from '../model/memory-types';
import { useAgentManagementOperation } from './use-agent-management-operation';

function newProposal(): MemoryProposalDraft {
	return { content: '', confidence: 0.5, expiresAtLocal: '', sourceRunId: '' };
}

export function useAppMemory(appId: string) {
	const items = ref<ManagedMemory[]>([]);
	const status = ref<AgentMemoryStatus | 'all'>('all');
	const offset = ref(0);
	const nextOffset = ref<number | null>(null);
	const original = ref<ManagedMemory | null>(null);
	const reviewContent = ref('');
	const proposal = ref(newProposal());
	const proposalUnknown = ref(false);
	const acknowledgeNewIntent = ref(false);
	const needsReload = ref(true);
	let listRevision = 0;
	const operation = useAgentManagementOperation(() => {
		items.value = [];
		status.value = 'all';
		offset.value = 0;
		nextOffset.value = null;
		original.value = null;
		reviewContent.value = '';
		proposal.value = newProposal();
		proposalUnknown.value = false;
		acknowledgeNewIntent.value = false;
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

	async function propose(): Promise<void> {
		if (blocked.value || proposalUnknown.value) {
			return;
		}
		const input = structuredClone(toRaw(proposal.value));
		await operation.execute(
			(signal) => proposeManagedMemory(appId, input, signal),
			() => {
				proposal.value = newProposal();
				needsReload.value = true;
			},
			{
				write: true,

				onFailure() {
					if (operation.notice.value === 'unknown') {
						proposalUnknown.value = true;
					}
				},
			},
		);
	}

	function startNewProposal(): void {
		if (blocked.value || !acknowledgeNewIntent.value) {
			return;
		}
		proposal.value = newProposal();
		proposalUnknown.value = false;
		acknowledgeNewIntent.value = false;
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
		proposal,
		proposalUnknown,
		acknowledgeNewIntent,
		needsReload,
		operation,
		blocked,
		load,
		edit,
		review,
		propose,
		startNewProposal,
		invalidate,
	};
}
