<script setup lang="ts">
	import { defineAsyncComponent } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiOverlayPanel } from '@/foundation/ui';
	const SuspendedSessionsPanel = defineAsyncComponent(() => import('./SuspendedSessionsPanel.vue'));
	import type { MarkedSuspendedSessionState, SuspendedSession } from '../model/suspended-session-types';

	withDefaults(
		defineProps<{ visible: boolean; canResume?: boolean; markedSessions?: MarkedSuspendedSessionState[] }>(),
		{
			canResume: false,

			markedSessions: () => [],
		},
	);
	const emit = defineEmits<{
		close: [];
		resume: [session: SuspendedSession];
		resumeMarked: [workspaceId: string];
		unmark: [workspaceId: string];
	}>();
	const { t } = useI18n();
</script>

<template>
	<UiOverlayPanel
		:visible="visible"
		teleport
		:close-on-escape="true"
		panel-class="!w-[calc(100vw-1.5rem)] !max-w-[30rem] !max-h-[82vh] flex flex-col overflow-hidden p-0"
		role="dialog"
		:aria-modal="true"
		:aria-label="t('suspendedSshSessions.modalTitle')"
		@close="emit('close')"
	>
		<div class="suspended-modal-header">
			<div class="suspended-modal-heading">
				<span class="suspended-modal-mark" aria-hidden="true">
					<i class="fas fa-pause"></i>
				</span>
				<h3 class="suspended-modal-title">{{ t('suspendedSshSessions.modalTitle') }}</h3>
			</div>
			<UiButton
				type="button"
				appearance="ghost"
				density="compact"
				icon-only
				:title="t('common.close')"
				:aria-label="t('common.close')"
				@click="emit('close')"
			>
				<i class="fas fa-times" aria-hidden="true"></i>
			</UiButton>
		</div>

		<div class="suspended-modal-body">
			<SuspendedSessionsPanel
				v-if="visible"
				page-scroll
				:can-resume="canResume"
				:marked-sessions="markedSessions"
				@resume="emit('resume', $event)"
				@resume-marked="emit('resumeMarked', $event)"
				@unmark="emit('unmark', $event)"
				@removed="emit('close')"
			/>
		</div>
	</UiOverlayPanel>
</template>

<style scoped>
	.suspended-modal-header {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 8px;
		padding: 9px 10px 9px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.suspended-modal-heading {
		display: flex;
		min-width: 0;
		flex: 1 1 auto;
		align-items: center;
		gap: 8px;
	}

	.suspended-modal-mark {
		display: grid;
		width: 26px;
		height: 26px;
		flex: 0 0 26px;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: var(--link-active-color);
		font-size: 10px;
	}

	.suspended-modal-title {
		margin: 0;
		overflow: hidden;
		color: var(--text-color);
		font-size: 12px;
		font-weight: 600;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.suspended-modal-body {
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 10px 12px 12px;
	}
</style>
