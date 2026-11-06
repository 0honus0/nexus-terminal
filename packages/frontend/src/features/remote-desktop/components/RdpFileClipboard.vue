<script setup lang="ts">
	import { onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiOverlayPanel, UiSpinner, type UiDensity } from '@/foundation/ui';
	import type {
		RemoteDesktopClipboardFile,
		RemoteDesktopFileClipboard,
		RemoteDesktopFileClipboardState,
	} from '../model/remote-desktop-types';

	const props = withDefaults(
		defineProps<{
			clipboard: RemoteDesktopFileClipboard | null;
			enabled: boolean;
			iconOnly?: boolean;
			density?: UiDensity;
		}>(),
		{ iconOnly: false, density: 'compact' },
	);
	const open = defineModel<boolean>('open', { default: false });
	const { t, locale } = useI18n();
	const picker = ref<HTMLInputElement | null>(null);
	const state = ref<RemoteDesktopFileClipboardState>({ files: [], canUpload: true, upload: null, downloads: [] });
	const message = ref('');
	const failed = ref(false);
	let revision = 0;
	let active = true;
	const urls = new Map<string, ReturnType<typeof setTimeout>>();

	watch(
		() => [props.clipboard, props.enabled] as const,
		([clipboard, enabled], _, cleanup) => {
			revision += 1;
			message.value = '';
			state.value = { files: [], canUpload: true, upload: null, downloads: [] };
			if (!clipboard || !enabled) {
				open.value = false;
				return;
			}
			cleanup(clipboard.subscribe((next) => (state.value = next)));
		},
		{ immediate: true },
	);

	const chooseFiles = async (event: Event) => {
		if (!(event.target instanceof HTMLInputElement)) return;
		const files = Array.from(event.target.files ?? []);
		event.target.value = '';
		const clipboard = props.clipboard;
		if (!clipboard || !props.enabled || !files.length) return;
		const original = revision;
		message.value = '';
		try {
			await clipboard.upload(files);
			if (!active || original !== revision) return;
			failed.value = false;
			message.value = t('remoteDesktopModal.fileClipboard.uploaded');
		} catch {
			if (!active || original !== revision) return;
			failed.value = true;
			message.value = t('remoteDesktopModal.fileClipboard.failed');
		}
	};

	const download = async (file: RemoteDesktopClipboardFile) => {
		const clipboard = props.clipboard;
		if (!clipboard || !props.enabled) return;
		const original = revision;
		message.value = '';
		try {
			const blob = await clipboard.download(file.id);
			if (!active || original !== revision || !state.value.files.some((item) => item.id === file.id)) return;
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			try {
				anchor.href = url;
				anchor.download = file.name;
				anchor.rel = 'noopener';
				document.body.append(anchor);
				anchor.click();
			} finally {
				anchor.remove();
				urls.set(
					url,
					setTimeout(() => {
						URL.revokeObjectURL(url);
						urls.delete(url);
					}, 0),
				);
			}
		} catch {
			if (!active || original !== revision) return;
			failed.value = true;
			message.value = t('remoteDesktopModal.fileClipboard.failed');
		}
	};

	const percent = (transferred: number, total: number) =>
		total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0;

	onBeforeUnmount(() => {
		active = false;
		for (const [url, timer] of urls) {
			clearTimeout(timer);
			URL.revokeObjectURL(url);
		}
		urls.clear();
	});
</script>

<template>
	<UiButton
		:density="density"
		:icon-only="iconOnly"
		:disabled="!enabled || !clipboard"
		:aria-label="t('remoteDesktopModal.fileClipboard.title')"
		:title="t('remoteDesktopModal.fileClipboard.title')"
		@click="open = true"
	>
		<template #leading><i class="fas fa-file-arrow-up" aria-hidden="true"></i></template>
		<span v-if="!iconOnly">{{ t('remoteDesktopModal.fileClipboard.title') }}</span>
		<span v-if="!iconOnly && state.files.length" class="text-text-muted">{{ state.files.length }}</span>
	</UiButton>
	<UiOverlayPanel
		:visible="open"
		:z-index="1200"
		preset="standard-modal"
		panel-class="w-[min(28rem,calc(100vw-2rem))] gap-4 text-foreground"
		role="dialog"
		aria-modal
		:aria-label="t('remoteDesktopModal.fileClipboard.title')"
		close-on-escape
		focus-on-open
		restore-focus
		@close="open = false"
	>
		<div class="flex items-center justify-between gap-3">
			<h3 class="font-medium">{{ t('remoteDesktopModal.fileClipboard.title') }}</h3>
			<UiButton
				icon-only
				appearance="ghost"
				density="compact"
				:aria-label="t('common.close')"
				@click="open = false"
			>
				<i class="fas fa-times" aria-hidden="true"></i>
			</UiButton>
		</div>
		<div class="space-y-3 text-sm">
			<p class="text-text-secondary">{{ t('remoteDesktopModal.fileClipboard.uploadHint') }}</p>
			<input ref="picker" type="file" multiple class="hidden" @change="chooseFiles" />
			<UiButton :disabled="!enabled || !state.canUpload" density="compact" @click="picker?.click()">
				{{ t('remoteDesktopModal.fileClipboard.choose') }}
			</UiButton>
			<div v-if="state.upload" class="space-y-2 rounded border border-border p-3" role="status">
				<p>
					{{
						t(
							state.upload.waiting
								? 'remoteDesktopModal.fileClipboard.waiting'
								: 'remoteDesktopModal.fileClipboard.uploading',
						)
					}}
				</p>
				<progress
					v-if="!state.upload.waiting"
					class="w-full"
					:aria-label="t('remoteDesktopModal.fileClipboard.uploading')"
					:value="state.upload.transferred"
					:max="state.upload.total || 1"
				/>
				<p class="text-xs text-text-muted">{{ percent(state.upload.transferred, state.upload.total) }}%</p>
			</div>
		</div>
		<div class="min-h-0 space-y-2 overflow-y-auto border-t border-border pt-3 text-sm">
			<p class="text-text-secondary">{{ t('remoteDesktopModal.fileClipboard.downloadHint') }}</p>
			<p v-if="!state.files.length" class="py-3 text-center text-text-muted">
				{{ t('remoteDesktopModal.fileClipboard.empty') }}
			</p>
			<ul v-else class="space-y-2">
				<li
					v-for="file in state.files"
					:key="file.id"
					class="flex min-w-0 items-center gap-3 rounded border border-border p-2"
				>
					<i
						:class="file.isDirectory ? 'fas fa-folder' : 'far fa-file'"
						class="shrink-0 text-text-muted"
						aria-hidden="true"
					></i>
					<div class="min-w-0 flex-1">
						<p class="truncate" :title="file.path ? `${file.path}\\${file.name}` : file.name">
							{{ file.name }}
						</p>
						<p class="truncate text-xs text-text-muted">
							{{
								file.isDirectory
									? t('remoteDesktopModal.fileClipboard.directory')
									: `${file.size.toLocaleString(locale)} B`
							}}
						</p>
						<template
							v-for="transfer in state.downloads.filter((item) => item.id === file.id)"
							:key="transfer.id"
						>
							<progress
								class="w-full"
								:aria-label="file.name"
								:value="transfer.transferred"
								:max="transfer.total || 1"
							/>
						</template>
					</div>
					<UiButton
						v-if="!file.isDirectory"
						density="compact"
						:disabled="state.downloads.some((item) => item.id === file.id)"
						@click="download(file)"
					>
						<UiSpinner v-if="state.downloads.some((item) => item.id === file.id)" />
						<span v-else>{{ t('remoteDesktopModal.fileClipboard.download') }}</span>
					</UiButton>
				</li>
			</ul>
		</div>
		<p v-if="message" role="status" class="text-sm" :class="failed ? 'text-red-400' : 'text-text-secondary'">
			{{ message }}
		</p>
	</UiOverlayPanel>
</template>
