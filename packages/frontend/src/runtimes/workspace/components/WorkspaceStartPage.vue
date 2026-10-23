<script setup lang="ts">
	import { defineAsyncComponent } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import type { ConnectionSummary } from '@/features/connections/public';
	import {
		loadSuspendedSessionsPanel,
		type MarkedSuspendedSessionState,
		type SuspendedSession,
	} from '@/features/ssh-suspend/public';
	import WorkspaceConnectionList from './WorkspaceConnectionList.vue';

	const props = defineProps<{
		markedSessions: MarkedSuspendedSessionState[];
		canReturn?: boolean;
		mobile?: boolean;
	}>();
	const emit = defineEmits<{
		open: [connection: ConnectionSummary];
		openMany: [connections: ConnectionSummary[]];
		resume: [session: SuspendedSession];
		resumeMarked: [workspaceId: string];
		unmark: [workspaceId: string];
		back: [];
	}>();
	const { t } = useI18n();
	const SuspendedSessionsPanel = defineAsyncComponent(loadSuspendedSessionsPanel);
</script>

<template>
	<section class="workspace-start-page min-h-0 flex-1 overflow-y-auto bg-background">
		<div class="workspace-start-shell">
			<header class="workspace-start-header">
				<div class="workspace-start-heading">
					<span class="workspace-start-mark" aria-hidden="true">
						<i class="fas fa-terminal"></i>
					</span>
					<h1>{{ t('workspace.start.title') }}</h1>
				</div>
				<UiButton v-if="props.canReturn" appearance="soft" density="compact" @click="emit('back')">
					<i class="fas fa-arrow-left mr-2" aria-hidden="true"></i>
					{{ t('workspace.start.back') }}
				</UiButton>
			</header>

			<div class="workspace-start-body">
				<section class="workspace-start-connections" :aria-label="t('workspace.start.connections')">
					<WorkspaceConnectionList
						launchpad
						page-scroll
						@open="emit('open', $event)"
						@open-many="emit('openMany', $event)"
					/>
				</section>

				<aside class="workspace-start-suspended" :aria-label="t('suspendedSshSessions.modalTitle')">
					<header class="workspace-start-section-title">
						<i class="fas fa-pause-circle" aria-hidden="true"></i>
						<h2>{{ t('suspendedSshSessions.modalTitle') }}</h2>
					</header>
					<SuspendedSessionsPanel
						:can-resume="true"
						:marked-sessions="props.markedSessions"
						page-scroll
						@resume="emit('resume', $event)"
						@resume-marked="emit('resumeMarked', $event)"
						@unmark="emit('unmark', $event)"
					/>
				</aside>
			</div>
		</div>
	</section>
</template>

<style scoped>
	.workspace-start-page {
		margin: 0 0.5rem 0.5rem;
		border: 1px solid var(--border-color);
		border-top: 0;
		border-radius: 0 0 0.375rem 0.375rem;
		background: var(--app-bg-color);
	}

	.workspace-start-shell {
		width: min(1160px, 100%);
		margin-inline: auto;
		padding: 2rem 1.5rem 3rem;
	}

	.workspace-start-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.75rem;
	}

	.workspace-start-heading {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.75rem;
	}

	.workspace-start-heading h1 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--text-color);
	}

	.workspace-start-mark {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		flex-shrink: 0;
		place-items: center;
		border-radius: 0.625rem;
		background: color-mix(in srgb, var(--link-active-color) 12%, transparent);
		color: var(--link-active-color);
		font-size: 0.875rem;
	}

	.workspace-start-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 20rem);
		align-items: start;
		gap: 2rem;
	}

	.workspace-start-connections,
	.workspace-start-suspended {
		min-width: 0;
	}

	.workspace-start-suspended {
		padding-left: 2rem;
		border-left: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
	}

	.workspace-start-section-title {
		display: flex;
		height: 2rem;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		color: var(--text-color);
	}

	.workspace-start-section-title i {
		width: 1rem;
		text-align: center;
		color: var(--link-active-color);
		font-size: 0.8125rem;
	}

	.workspace-start-section-title h2 {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	@media (max-width: 1023px) {
		.workspace-start-shell {
			padding: 1.25rem 1rem 2rem;
		}

		.workspace-start-header {
			margin-bottom: 1.25rem;
		}

		.workspace-start-body {
			grid-template-columns: minmax(0, 1fr);
		}

		.workspace-start-suspended {
			padding-top: 1.5rem;
			padding-left: 0;
			border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
			border-left: 0;
		}
	}

	@media (max-width: 480px) {
		.workspace-start-shell {
			padding: 1rem 0.75rem 1.5rem;
		}

		.workspace-start-heading h1 {
			font-size: 1rem;
		}

		.workspace-start-body {
			gap: 1.5rem;
		}
	}

	@media (max-width: 767px) {
		.workspace-start-page {
			margin: 0;
			border: 0;
			border-radius: 0;
		}
	}
</style>
