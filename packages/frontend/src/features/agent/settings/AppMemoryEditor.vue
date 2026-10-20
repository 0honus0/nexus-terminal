<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
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
		needsReload,
		operation,
		blocked,
		load,
		edit,
		review,
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
		<article v-for="memory in items" :key="memory.id" class="space-y-2 rounded-lg bg-header/25 p-3.5">
			<h4>
				{{ t('agent.settings.memoryManagement.' + memory.status) }} · {{ Math.round(memory.confidence * 100) }}%
			</h4>
			<p class="whitespace-pre-wrap break-words text-sm">{{ memory.content }}</p>
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
			<UiButton type="button" :disabled="blocked" @click="edit(memory)">{{
				t('agent.settings.memoryManagement.readReview')
			}}</UiButton>
		</article>
		<form v-if="original" class="space-y-3 rounded border border-border p-3" @submit.prevent="review('publish')">
			<h4>{{ t('agent.settings.memoryManagement.readReview') }}</h4>
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
		<MemoryImportEditor :app-id="appId" :apps="apps" @imported="invalidate" />
	</div>
</template>
