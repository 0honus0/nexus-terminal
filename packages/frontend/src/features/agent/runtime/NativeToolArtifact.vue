<script setup lang="ts">
	import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiOverlayPanel } from '@/foundation/ui';
	import { usePreferences } from '@/features/preferences/public';
	import { createFilePreviewSession, loadFilePreview, previewKindFor } from '@/features/file-preview/public';
	import { getManagedArtifact } from '../api/artifact-management-api';
	import type { ManagedArtifact } from '../model/artifact-types';
	import { createArtifactPreviewSource } from '../files/artifact-preview-source';
	import AgentMessageBody from '../ai/AgentMessageBody.vue';

	const props = defineProps<{ appId: string; artifactId: string | null; active: boolean }>();
	const { t, locale } = useI18n();
	const preferences = usePreferences();
	const item = ref<ManagedArtifact | null>(null);
	const failed = ref(false);
	let pending: AbortController | null = null;
	const FilePreview = defineAsyncComponent(loadFilePreview);
	const session = createFilePreviewSession(undefined, () => preferences.values.value.imagePreviewMaxMiB);
	const previewVisible = ref(false);
	const previewMounted = ref(false);
	const contentPath = computed(() =>
		props.artifactId === null
			? ''
			: '/api/v1/agent/apps/' +
				encodeURIComponent(props.appId) +
				'/artifacts/' +
				encodeURIComponent(props.artifactId),
	);
	const inlineImage = computed(
		() =>
			item.value !== null &&
			['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.value.mediaType),
	);
	const previewable = computed(() => item.value !== null && previewKindFor(item.value.name) !== 'unsupported');
	const imageMarkdown = computed(() => '![Image](' + contentPath.value + '/preview)');
	const previewSource = computed(() =>
		item.value === null ? null : createArtifactPreviewSource(item.value, t('agent.files.previewLoadFailed')),
	);
	const sizeLabel = computed(() =>
		item.value === null
			? ''
			: new Intl.NumberFormat(locale.value, {
					style: 'unit',
					unit: 'byte',
					unitDisplay: 'short',
					notation: 'compact',
					maximumFractionDigits: 1,
				}).format(item.value.sizeBytes),
	);

	function closePreview(): void {
		previewVisible.value = false;
		previewMounted.value = false;
		session.clear();
	}

	async function load(): Promise<void> {
		pending?.abort();
		pending = null;
		if (!props.active || props.artifactId === null) return;
		if (item.value?.id === props.artifactId && item.value.appId === props.appId) return;
		const controller = new AbortController();
		pending = controller;
		failed.value = false;
		try {
			const current = await getManagedArtifact(props.appId, props.artifactId, controller.signal);
			if (pending !== controller || controller.signal.aborted) return;
			if (
				current.status !== 'ready' ||
				(!current.retained && current.expiresAt !== null && current.expiresAt <= Date.now())
			) {
				failed.value = true;
				return;
			}
			item.value = current;
		} catch {
			if (pending === controller && !controller.signal.aborted) failed.value = true;
		} finally {
			if (pending === controller) pending = null;
		}
	}

	async function openPreview(): Promise<void> {
		const current = item.value;
		if (!props.active || current === null || !previewable.value) return;
		previewMounted.value = true;
		previewVisible.value = true;
		await session.open(current.name, {
			scopeId: current.id,
			source: createArtifactPreviewSource(current, t('agent.files.previewLoadFailed')),
		});
	}

	watch(
		() => [props.appId, props.artifactId] as const,
		() => {
			item.value = null;
			closePreview();
			void load();
		},
		{ immediate: true },
	);
	watch(
		() => props.active,
		(active) => {
			if (active) void load();
			else {
				pending?.abort();
				pending = null;
				closePreview();
			}
		},
	);
	onBeforeUnmount(() => {
		pending?.abort();
		pending = null;
		session.clear();
	});
</script>
<template>
	<div data-tool-artifact :data-artifact-id="artifactId" class="my-2 min-w-0">
		<AgentMessageBody v-if="inlineImage" :text="imageMarkdown" />
		<div
			v-else-if="item"
			class="flex min-w-0 items-center gap-3 rounded-xl border border-border/50 bg-header/25 px-3 py-2.5"
		>
			<i class="fa-regular fa-file-lines shrink-0 text-primary" aria-hidden="true"></i>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium text-foreground" :title="item.name">{{ item.name }}</p>
				<p class="text-xs text-text-secondary">{{ sizeLabel }}</p>
			</div>
			<UiButton
				v-if="previewable"
				appearance="ghost"
				density="compact"
				icon-only
				:disabled="!active"
				:aria-label="t('agent.files.preview')"
				:title="t('agent.files.preview')"
				@click="openPreview"
			>
				<i class="fa-regular fa-eye" aria-hidden="true"></i>
			</UiButton>
			<a
				:href="contentPath + '/content'"
				:download="item.name"
				rel="noopener"
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
				:aria-label="t('agent.files.download')"
				:title="t('agent.files.download')"
			>
				<i class="fa-solid fa-download" aria-hidden="true"></i>
			</a>
		</div>
		<div v-else-if="failed" class="flex items-center gap-2 text-xs text-text-secondary" role="status">
			<span>{{ t('agent.files.deliveryUnavailable') }}</span>
			<UiButton appearance="ghost" density="compact" :disabled="!active" @click="load">{{
				t('common.retry')
			}}</UiButton>
		</div>
		<UiOverlayPanel
			:visible="previewVisible"
			teleport
			:z-index="60"
			:close-on-backdrop="true"
			:close-on-escape="true"
			:focus-on-open="true"
			:restore-focus="true"
			role="dialog"
			:aria-modal="true"
			:aria-label="t('agent.files.preview')"
			panel-class="flex h-[min(760px,90dvh)] w-full max-w-[1180px] min-h-0 flex-col overflow-hidden !p-0"
			overlay-class="p-2 sm:p-4"
			@close="closePreview"
		>
			<FilePreview
				v-if="previewMounted && previewSource"
				class="min-h-0 flex-1"
				:source="previewSource"
				:session="session"
				@hide="closePreview"
				@dismiss="closePreview"
			/>
		</UiOverlayPanel>
	</div>
</template>
