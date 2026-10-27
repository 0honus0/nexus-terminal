<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiLoadingState, UiFormActions, UiOverlayPanel } from '@/foundation/ui';
	import { useRemoteDirectoryPicker } from '../composables/useRemoteDirectoryPicker';

	const props = defineProps<{ targetId: number; targetName: string; initialPath: string }>();
	const emit = defineEmits<{ close: []; select: [path: string] }>();
	const { t } = useI18n();
	const { path, entries, busy, ready, listed, navigate } = useRemoteDirectoryPicker(
		props.targetId,
		props.initialPath,
	);
	const parentPath = computed(() => path.value.slice(0, path.value.lastIndexOf('/')) || '/');

	function select(): void {
		if (ready.value && !busy.value) emit('select', path.value);
	}
</script>

<template>
	<UiOverlayPanel
		:visible="true"
		:z-index="80"
		teleport
		panel-class="ui-form-surface !w-[calc(100vw-1rem)] !max-w-[46rem] !h-[calc(100dvh-1rem)] !max-h-[calc(100dvh-1rem)] !p-0 overflow-hidden sm:!w-[calc(100vw-2rem)] sm:!h-[min(36rem,calc(100dvh-2rem))] sm:!max-h-[calc(100dvh-2rem)]"
		role="dialog"
		:aria-modal="true"
		:aria-label="t('fileManager.directoryPicker.title')"
		focus-on-open
		restore-focus
		close-on-escape
		@close="emit('close')"
	>
		<div class="directory-picker">
			<header class="directory-picker__header">
				<span class="directory-picker__mark" aria-hidden="true">
					<i class="fa-solid fa-folder-tree"></i>
				</span>
				<div class="directory-picker__heading">
					<h3>{{ t('fileManager.directoryPicker.title') }}</h3>
					<p><i class="fa-solid fa-server" aria-hidden="true"></i>{{ targetName }}</p>
				</div>
				<UiButton
					type="button"
					appearance="ghost"
					icon-only
					:aria-label="t('common.close')"
					@click="emit('close')"
				>
					<i class="fa-solid fa-xmark" aria-hidden="true"></i>
				</UiButton>
			</header>

			<div class="directory-picker__toolbar">
				<div class="directory-picker__path">
					<i class="fa-solid fa-folder directory-picker__path-icon" aria-hidden="true"></i>
					<output data-directory-picker-path aria-live="polite">{{ path }}</output>
				</div>
				<div class="directory-picker__tools">
					<UiButton
						type="button"
						appearance="soft"
						density="compact"
						icon-only
						:disabled="busy"
						:aria-label="t('fileManager.directoryPicker.root')"
						:title="t('fileManager.directoryPicker.root')"
						@click="navigate('/')"
					>
						<i class="fa-solid fa-hard-drive" aria-hidden="true"></i>
					</UiButton>
					<UiButton
						type="button"
						appearance="soft"
						density="compact"
						icon-only
						:disabled="busy || path === '/'"
						:aria-label="t('fileManager.actions.parentDirectory')"
						:title="t('fileManager.actions.parentDirectory')"
						@click="navigate(parentPath)"
					>
						<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
					</UiButton>
					<UiButton
						type="button"
						appearance="soft"
						density="compact"
						icon-only
						:disabled="busy"
						:aria-label="t('fileManager.actions.refresh')"
						:title="t('fileManager.actions.refresh')"
						@click="navigate(path)"
					>
						<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
					</UiButton>
				</div>
			</div>

			<div class="directory-picker__list-panel" :aria-busy="busy">
				<UiLoadingState v-if="busy" compact :bordered="false" :title="t('fileManager.loading')" />
				<UiEmptyState
					v-else-if="!ready || !listed"
					compact
					:bordered="false"
					:title="t('fileManager.directoryPicker.unavailable')"
				/>
				<UiEmptyState
					v-else-if="!entries.length"
					compact
					:bordered="false"
					icon="fa-solid fa-folder-open"
					:title="t('fileManager.directoryPicker.empty')"
				/>
				<ul v-else class="directory-picker__list">
					<li v-for="entry in entries" :key="entry.path">
						<button
							type="button"
							class="directory-picker__row"
							:aria-label="entry.name"
							@click="navigate(entry.path)"
						>
							<span class="directory-picker__entry-icon" aria-hidden="true">
								<i :class="entry.kind === 'symlink' ? 'fa-solid fa-link' : 'fa-solid fa-folder'"></i>
							</span>
							<span class="directory-picker__entry-name">{{ entry.name }}</span>
							<i class="fa-solid fa-chevron-right directory-picker__entry-chevron" aria-hidden="true"></i>
						</button>
					</li>
				</ul>
			</div>

			<footer class="directory-picker__footer">
				<UiFormActions>
					<UiButton type="button" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
					<UiButton
						type="button"
						appearance="solid"
						tone="primary"
						:disabled="busy || !ready"
						@click="select"
						>{{ t('fileManager.directoryPicker.select') }}</UiButton
					>
				</UiFormActions>
			</footer>
		</div>
	</UiOverlayPanel>
</template>

<style scoped>
	.directory-picker {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
	}

	.directory-picker__header {
		display: flex;
		flex: none;
		align-items: center;
		gap: 12px;
		padding: 16px 20px 14px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 32%, transparent);
	}

	.directory-picker__mark {
		display: inline-flex;
		width: 36px;
		height: 36px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 11px;
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--link-active-color) 18%, transparent),
			color-mix(in srgb, var(--card-bg-color) 30%, transparent)
		);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-rim) 16%, transparent);
		color: var(--link-active-color);
		font-size: 14px;
	}

	.directory-picker__heading {
		min-width: 0;
		flex: 1 1 auto;
	}

	.directory-picker__heading h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		line-height: 1.3;
	}

	.directory-picker__heading p {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
		margin: 2px 0 0;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 10.5px;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.directory-picker__heading p i {
		flex: none;
		font-size: 9px;
	}

	.directory-picker__toolbar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		padding: 12px 20px 10px;
	}

	.directory-picker__path {
		display: flex;
		min-width: 0;
		height: 34px;
		flex: 1 1 auto;
		align-items: center;
		gap: 8px;
		border-radius: 9px;
		padding: 0 10px;
		background: var(--ui-fill-inset);
		box-shadow: var(--glass-inset-highlight);
	}

	.directory-picker__path-icon {
		flex: none;
		color: var(--text-color-secondary);
		font-size: 10px;
	}

	.directory-picker__path output {
		min-width: 0;
		flex: 1 1 auto;
		overflow-x: auto;
		color: var(--text-color);
		font-family: var(--font-family-monospace);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		line-height: 1.3;
		scrollbar-width: none;
		white-space: nowrap;
	}

	.directory-picker__path output::-webkit-scrollbar {
		display: none;
	}

	.directory-picker__tools {
		display: flex;
		flex: none;
		align-items: center;
		gap: 4px;
	}

	.directory-picker__list-panel {
		min-height: 0;
		flex: 1 1 auto;
		margin: 0 20px;
		overflow-y: auto;
		border-radius: 13px;
		background: color-mix(in srgb, var(--card-bg-color) 12%, transparent);
		scrollbar-gutter: stable;
	}

	.directory-picker__list {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 6px;
		list-style: none;
	}

	.directory-picker__row {
		display: flex;
		width: 100%;
		min-width: 0;
		min-height: 42px;
		align-items: center;
		gap: 10px;
		border: 0;
		border-radius: 9px;
		padding: 5px 9px;
		background: transparent;
		color: var(--text-color);
		cursor: pointer;
		font: inherit;
		text-align: left;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.directory-picker__row:hover {
		background: var(--ui-fill-soft-hover);
	}

	.directory-picker__row:focus-visible {
		outline: 1px solid var(--ui-focus-color);
		outline-offset: -1px;
	}

	.directory-picker__entry-icon {
		display: inline-flex;
		width: 29px;
		height: 29px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--link-active-color) 9%, transparent);
		color: color-mix(in srgb, var(--link-active-color) 68%, var(--text-color-secondary));
		font-size: 11px;
	}

	.directory-picker__entry-name {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		font-size: 12px;
		font-weight: 520;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.directory-picker__entry-chevron {
		flex: none;
		color: var(--text-color-secondary);
		font-size: 8px;
		opacity: 0.48;
	}

	.directory-picker__footer {
		flex: none;
		padding: 12px 20px 16px;
	}

	@media (max-width: 639px) {
		.directory-picker__header {
			padding: 14px 16px 12px;
		}

		.directory-picker__toolbar {
			gap: 6px;
			padding: 10px 16px 8px;
		}

		.directory-picker__tools {
			gap: 2px;
		}

		.directory-picker__list-panel {
			margin: 0 16px;
		}

		.directory-picker__row {
			min-height: 46px;
		}

		.directory-picker__footer {
			padding: 12px 16px 16px;
		}
	}
</style>
