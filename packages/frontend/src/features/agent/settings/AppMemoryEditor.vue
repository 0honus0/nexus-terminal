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
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
					:class="
						memory.status === 'candidate'
							? 'border-warning/30 bg-warning/10 text-warning'
							: memory.status === 'published'
								? 'border-success/30 bg-success/10 text-success'
								: 'border-border bg-header text-text-secondary'
					"
				>
					{{ t('agent.settings.memoryManagement.' + memory.status) }}
				</span>
				<span class="text-[11px] text-text-secondary">{{ Math.round(memory.confidence * 100) }}%</span>
			</div>
			<p
				v-if="original?.id !== memory.id"
				class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground"
			>
				{{ memory.content }}
			</p>
			<p class="text-xs">
				{{
					t('agent.settings.memoryManagement.times', {
						updated: formatTime(memory.updatedAt),
						expires: formatTime(memory.expiresAt),
					})
				}}
			</p>
			<UiButton
				v-if="memory.status === 'candidate' || memory.status === 'published'"
				type="button"
				appearance="soft"
				density="compact"
				:disabled="blocked"
				@click="edit(memory)"
				>{{ t('agent.settings.memoryManagement.readReview') }}</UiButton
			>
			<form v-if="original?.id === memory.id" class="mt-3 space-y-3" @submit.prevent="review('publish')">
				<fieldset :disabled="blocked" class="space-y-3">
					<textarea
						v-if="original.status === 'candidate'"
						v-model="reviewContent"
						rows="4"
						:aria-label="t('agent.settings.memoryManagement.content')"
						class="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground"
					/>
					<p v-else class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
						{{ original.content }}
					</p>
					<div class="flex flex-wrap gap-2">
						<template v-if="original.status === 'candidate'"
							><UiButton
								type="submit"
								appearance="solid"
								tone="primary"
								:disabled="!reviewContent.trim()"
								>{{ t('agent.settings.memoryManagement.publish') }}</UiButton
							><UiButton type="button" appearance="soft" tone="danger" @click="review('reject')">{{
								t('agent.settings.memoryManagement.reject')
							}}</UiButton></template
						>
						<UiButton
							v-if="original.status === 'published'"
							type="button"
							appearance="soft"
							tone="danger"
							@click="review('revoke')"
							>{{ t('agent.settings.memoryManagement.revoke') }}</UiButton
						>
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
		</article>

		<MemoryImportEditor :app-id="appId" :apps="apps" @imported="invalidate" />
	</div>
</template>
