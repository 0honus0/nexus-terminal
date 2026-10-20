<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import { AGENT_MEMORY_STATUSES } from '@nexus-terminal/shared/agent/memory/values';
	import type { ManagedApp } from '../model/app-management-types';
	import { useAppMemory } from '../composables/use-app-memory';
	import { formatAgentDateTime } from '../locale-format';
	import MemoryImportEditor from './MemoryImportEditor.vue';

	const props = defineProps<{ appId: string; apps: ManagedApp[] }>();
	const { t, locale } = useI18n();
	const {
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
	} = useAppMemory(props.appId);

	function formatTime(value: number | null): string {
		return value === null ? '—' : formatAgentDateTime(locale.value, new Date(value));
	}
</script>
<template>
	<div class="space-y-4">
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="needsReload || operation.refreshRequired.value" class="text-sm text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<label
				>{{ t('agent.settings.memoryManagement.status')
				}}<select
					v-model="status"
					:disabled="operation.busy.value"
					class="ml-2 rounded border border-border bg-background p-2"
					@change="load()"
				>
					<option value="all">{{ t('agent.settings.memoryManagement.all') }}</option>
					<option v-for="value in AGENT_MEMORY_STATUSES" :key="value" :value="value">
						{{ t('agent.settings.memoryManagement.' + value) }}
					</option>
				</select></label
			>
			<UiButton type="button" :disabled="operation.busy.value" @click="load()">{{
				t('agent.settings.memoryManagement.reload')
			}}</UiButton>
			<UiButton
				type="button"
				:disabled="operation.busy.value || offset === 0"
				@click="load(Math.max(0, offset - 20))"
				>{{ t('agent.settings.memoryManagement.previous') }}</UiButton
			>
			<UiButton
				type="button"
				:disabled="operation.busy.value || nextOffset === null"
				@click="nextOffset !== null && load(nextOffset)"
				>{{ t('agent.settings.memoryManagement.next') }}</UiButton
			>
		</div>
		<p v-if="items.length === 0" class="text-sm">{{ t('agent.settings.memoryManagement.empty') }}</p>
		<article v-for="memory in items" :key="memory.id" class="space-y-2 rounded border border-border p-3">
			<h4>
				{{ t('agent.settings.memoryManagement.' + memory.status) }} · v{{ memory.version }} ·
				{{ Math.round(memory.confidence * 100) }}%
			</h4>
			<p class="whitespace-pre-wrap break-words text-sm">{{ memory.content }}</p>
			<p class="break-all text-xs">{{ memory.id }}</p>
			<p class="text-xs">
				{{
					t('agent.settings.memoryManagement.times', {
						created: formatTime(memory.createdAt),
						updated: formatTime(memory.updatedAt),
						reviewed: formatTime(memory.reviewedAt),
						expires: formatTime(memory.expiresAt),
					})
				}}
			</p>
			<p v-if="memory.sourceRunId" class="break-all text-xs">Run: {{ memory.sourceRunId }}</p>
			<UiButton type="button" :disabled="blocked" @click="edit(memory)">{{
				t('agent.settings.memoryManagement.readReview')
			}}</UiButton>
		</article>
		<form v-if="original" class="space-y-3 rounded border border-border p-3" @submit.prevent="review('publish')">
			<h4 class="break-all">{{ original.id }} · v{{ original.version }}</h4>
			<fieldset :disabled="blocked" class="space-y-3">
				<textarea
					v-model="reviewContent"
					:readonly="original.status !== 'candidate'"
					rows="5"
					:aria-label="t('agent.settings.memoryManagement.content')"
					class="w-full rounded border border-border bg-background p-2"
				/>
				<div class="flex flex-wrap gap-2">
					<template v-if="original.status === 'candidate'"
						><UiButton type="submit">{{ t('agent.settings.memoryManagement.publish') }}</UiButton
						><UiButton type="button" @click="review('reject')">{{
							t('agent.settings.memoryManagement.reject')
						}}</UiButton></template
					>
					<UiButton v-if="original.status === 'published'" type="button" @click="review('revoke')">{{
						t('agent.settings.memoryManagement.revoke')
					}}</UiButton>
					<UiButton
						type="button"
						@click="
							original = null;
							reviewContent = '';
						"
						>{{ t('common.cancel') }}</UiButton
					>
				</div>
			</fieldset>
		</form>
		<form class="space-y-3 rounded border border-border p-3" @submit.prevent="propose">
			<h4>{{ t('agent.settings.memoryManagement.propose') }}</h4>
			<fieldset :disabled="blocked || proposalUnknown" class="space-y-3">
				<label class="block text-sm"
					>{{ t('agent.settings.memoryManagement.content')
					}}<textarea
						v-model="proposal.content"
						rows="5"
						class="mt-1 w-full rounded border border-border bg-background p-2"
					/>
				</label>
				<label class="block text-sm"
					>{{ t('agent.settings.memoryManagement.confidence')
					}}<input
						v-model.number="proposal.confidence"
						type="number"
						min="0"
						max="1"
						step="0.01"
						class="ml-2 rounded border border-border bg-background p-2"
				/></label>
				<label class="block text-sm"
					>{{ t('agent.settings.memoryManagement.expiry')
					}}<input
						v-model="proposal.expiresAtLocal"
						type="datetime-local"
						class="ml-2 rounded border border-border bg-background p-2"
				/></label>
				<label class="block text-sm"
					>{{ t('agent.settings.memoryManagement.sourceRun')
					}}<input
						v-model="proposal.sourceRunId"
						class="mt-1 w-full rounded border border-border bg-background p-2"
				/></label>
				<UiButton type="submit">{{ t('agent.settings.memoryManagement.propose') }}</UiButton>
			</fieldset>
			<template v-if="proposalUnknown">
				<p class="text-sm text-warning">{{ t('agent.settings.memoryManagement.proposalUnknown') }}</p>
				<UiCheckbox v-model="acknowledgeNewIntent">{{
					t('agent.settings.memoryManagement.acknowledgeNew')
				}}</UiCheckbox>
				<UiButton type="button" :disabled="blocked || !acknowledgeNewIntent" @click="startNewProposal">{{
					t('agent.settings.memoryManagement.newIntent')
				}}</UiButton>
			</template>
		</form>
		<MemoryImportEditor :app-id="appId" :apps="apps" @imported="invalidate" />
	</div>
</template>
