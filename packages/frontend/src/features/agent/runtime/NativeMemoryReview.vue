<script setup lang="ts">
	import { watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState } from '@/foundation/ui';
	import { useConversationMemory } from '../composables/use-conversation-memory';
	const props = defineProps<{ appId: string; threadId: string; active: boolean; visible: boolean }>();
	const emit = defineEmits<{
		close: [];
		proposed: [threadId: string];
		summary: [threadId: string, count: number, needsRead: boolean];
	}>();
	const { t } = useI18n();
	const { items, hasMore, needsRead, writeBlocked, operation, load, review } = useConversationMemory(
		props.appId,
		props.threadId,
		() => props.active,
		() => emit('proposed', props.threadId),
	);
	watch([() => items.value.length, needsRead], ([count, unread]) => emit('summary', props.threadId, count, unread), {
		immediate: true,
	});
</script>

<template>
	<aside v-show="visible" id="agent-memory-rail" :aria-label="t('agent.memoryReview.title')">
		<header class="mb-3 flex items-center justify-between border-b border-border/50 pb-2">
			<h3 class="text-xs font-semibold">{{ t('agent.memoryReview.title') }}</h3>
			<UiButton
				density="compact"
				appearance="ghost"
				icon-only
				:aria-label="t('common.close')"
				@click="emit('close')"
			>
				<i class="fa-solid fa-xmark" aria-hidden="true"></i>
			</UiButton>
		</header>
		<p class="mb-3 text-xs text-text-secondary">{{ t('agent.memoryReview.hint') }}</p>
		<UiButton v-if="needsRead" class="mb-3" :disabled="operation.busy.value" @click="load(true)">{{
			t('agent.memoryReview.reload')
		}}</UiButton>
		<UiEmptyState
			v-if="!items.length && !needsRead"
			compact
			:bordered="false"
			icon="fa-solid fa-brain"
			:title="t('agent.memoryReview.empty')"
		/>
		<div class="space-y-3">
			<article v-for="item in items" :key="item.id" class="rounded-lg border border-border/50 bg-background p-3">
				<p class="whitespace-pre-wrap break-words text-sm">{{ item.content }}</p>
				<p
					v-if="item.expiresAt !== null && item.expiresAt <= Date.now()"
					class="mt-2 text-xs text-text-secondary"
				>
					{{ t('agent.memoryReview.expired') }}
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<UiButton
						:disabled="
							operation.busy.value ||
							operation.refreshRequired.value ||
							needsRead ||
							writeBlocked ||
							(item.expiresAt !== null && item.expiresAt <= Date.now())
						"
						@click="review(item, 'publish')"
						>{{ t('agent.memoryReview.save') }}</UiButton
					>
					<UiButton
						appearance="ghost"
						:disabled="operation.busy.value || operation.refreshRequired.value || needsRead || writeBlocked"
						@click="review(item, 'reject')"
						>{{ t('agent.memoryReview.reject') }}</UiButton
					>
				</div>
			</article>
		</div>
		<p v-if="hasMore" class="mt-3 text-xs text-text-secondary">{{ t('agent.memoryReview.more') }}</p>
	</aside>
</template>
