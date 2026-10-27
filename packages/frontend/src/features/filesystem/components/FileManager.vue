<script setup lang="ts">
	import { useResizeObserver } from '@vueuse/core';
	import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiDialog,
		UiEmptyState,
		UiLoadingState,
		UiFormActions,
		UiFormField,
		UiInlineLoading,
		UiInlineNotice,
		UiInput,
		UiSpinner,
	} from '@/foundation/ui';
	import { useDeviceCapabilities } from '@/foundation/browser';
	import { writeClipboardText } from '@/foundation/browser';
	import { useWheelScale, useLongPressGesture } from '@/foundation/interaction';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { useFeedback } from '@/shared/feedback/public';
	import { focusRegistry } from '@/shared/focus/public';
	import FilesystemCatalogModal from './FilesystemCatalogModal.vue';
	import PathHistoryDropdown from './PathHistoryDropdown.vue';
	import {
		createFilesystemSessionState,
		type FilesystemSessionState,
	} from '../composables/createFilesystemSessionState';
	import { useFilesystemCatalog } from '../composables/useFilesystemCatalog';
	import { collectDroppedLocalFiles } from '../composables/collectDroppedLocalFiles';
	import type { FilesystemChannel, FilesystemDownloadPort, TerminalDirectoryPort } from '../ports/filesystem-channel';
	import { filesystemFailureMessage } from '../model/filesystem-feedback';
	import { TerminalDirectoryFailure } from '../model/terminal-directory-types';
	import type {
		ArchiveCompressionFormat,
		ArchiveCompressionIntent,
		LocalUploadFile,
		RemoteFileEntry,
	} from '../model/filesystem-types';

	const props = withDefaults(
		defineProps<{
			active?: boolean;
			connecting?: boolean;
			connected: boolean;
			channel: FilesystemChannel;
			beforeFileMutation?: (paths: readonly string[]) => boolean;
			download?: FilesystemDownloadPort;
			terminalDirectory?: TerminalDirectoryPort;
			initialPath?: string;
			confirmDelete?: boolean;
			rowScale?: number;
			columnWidths?: Record<string, number>;
			clipboardCount?: number;
			state?: FilesystemSessionState;
			showEditorButton?: boolean;
		}>(),
		{ active: true, connecting: false, confirmDelete: true, rowScale: 1, showEditorButton: false },
	);
	const emit = defineEmits<{
		openFile: [entry: RemoteFileEntry];
		openAsText: [entry: RemoteFileEntry];
		openEditor: [];
		upload: [path: string];
		uploadFiles: [path: string, files: LocalUploadFile[], directories: string[]];
		copyToClipboard: [entries: RemoteFileEntry[]];
		cutToClipboard: [entries: RemoteFileEntry[]];
		moveTo: [entries: RemoteFileEntry[], destination: string];
		paste: [destination: string];
		compress: [entries: RemoteFileEntry[]];
		compressPreset: [intent: ArchiveCompressionIntent];
		decompress: [entry: RemoteFileEntry];
		sendFiles: [entries: RemoteFileEntry[]];
		rowScale: [scale: number];
		columnWidths: [widths: Record<string, number>];
	}>();
	const { t } = useI18n();
	const device = useDeviceCapabilities();
	const feedback = useFeedback();
	const ownsFilesystemState = !props.state;
	const filesystemState = props.state ?? createFilesystemSessionState(props.channel, props.initialPath ?? '/');
	const browser = filesystemState.browser;
	const loading = computed(() => props.connecting || (props.connected && browser.loading.value));
	const showLoading = ref(false);
	let loadingIndicatorTimer: number | undefined;
	const stopLoadingWatch = watch(
		loading,
		(loading) => {
			if (loadingIndicatorTimer !== undefined) window.clearTimeout(loadingIndicatorTimer);
			loadingIndicatorTimer = undefined;
			if (!loading) showLoading.value = false;
			else
				loadingIndicatorTimer = window.setTimeout(() => {
					loadingIndicatorTimer = undefined;
					showLoading.value = true;
				}, 150);
		},
		{ immediate: true },
	);
	const catalog = useFilesystemCatalog();
	const action = ref<'mkdir' | 'file' | 'rename' | 'chmod' | null>(null);
	const actionBusy = ref(false);
	let actionRevision = 0;
	const target = ref<RemoteFileEntry | null>(null);
	const value = ref('');
	const catalogVisible = ref(false);
	const searchExpanded = ref(false);
	const pathDraft = ref(props.initialPath ?? '/');
	const pathDraftEditing = ref(false);
	let pathDraftRevision = 0;
	const pathHistoryOpen = ref(false);
	const pathHistoryIndex = ref(-1);
	let pathHistoryCloseTimer: number | undefined;
	const root = ref<HTMLElement | null>(null);
	const pathInput = ref<{ focus?: () => void; select?: () => void } | null>(null);
	const searchInput = ref<{ focus?: () => void } | null>(null);
	const favoriteButton = ref<HTMLButtonElement | null>(null);
	const actionInput = ref<{ focus?: () => void; select?: () => void } | null>(null);
	const listScroller = ref<HTMLElement | null>(null);
	const keyboardCursor = ref<string | null>(null);
	const multiSelect = ref(false);
	const dragging = ref(false);
	const draggedRemoteEntries = ref<RemoteFileEntry[]>([]);
	const remoteDragTarget = ref<string | null>(null);
	let remoteDragScrollTimer: number | undefined;
	let remoteDragScrollDirection = 0;
	type FileManagerContext =
		| { scope: 'entry'; entry: RemoteFileEntry; x: number; y: number }
		| { scope: 'current-directory' | 'parent-directory'; destination: string; x: number; y: number };
	const context = ref<FileManagerContext | null>(null);
	const contextDownloadLabel = computed(() => {
		const value = context.value;
		if (!value || value.scope !== 'entry') return t('fileManager.actions.download');
		return value.entry.metadata.isDirectory
			? t('fileManager.actions.downloadFolder')
			: t('fileManager.actions.download');
	});
	const shortcutHints = {
		cut: 'Ctrl+X',
		copy: 'Ctrl+C',
		paste: 'Ctrl+V',
		delete: 'Delete',
		rename: 'F2',
		newFolder: 'Ctrl+Shift+N',
		refresh: 'F5',
	} as const;
	const actionTitle = computed(() => {
		if (action.value === 'mkdir') return t('fileManager.modals.titles.newFolder');
		if (action.value === 'file') return t('fileManager.modals.titles.newFile');
		if (action.value === 'rename') return t('fileManager.modals.titles.rename', { name: target.value?.name ?? '' });
		if (action.value === 'chmod') return t('fileManager.modals.titles.chmod', { name: target.value?.name ?? '' });
		return '';
	});
	const actionIcon = computed(() => {
		if (action.value === 'mkdir') return 'fas fa-folder-plus';
		if (action.value === 'file') return 'far fa-file-alt';
		if (action.value === 'rename') return 'fas fa-i-cursor';
		if (action.value === 'chmod') return 'fas fa-key';
		return 'fas fa-pen';
	});
	const actionLabel = computed(() => {
		if (action.value === 'mkdir') return t('fileManager.modals.labels.folderName');
		if (action.value === 'file') return t('fileManager.modals.labels.fileName');
		if (action.value === 'rename') return t('fileManager.modals.labels.newName');
		if (action.value === 'chmod') return t('fileManager.modals.labels.newPermissions');
		return '';
	});
	const actionPlaceholder = computed(() => {
		if (action.value === 'mkdir') return t('fileManager.modals.placeholders.newFolder');
		if (action.value === 'file') return t('fileManager.modals.placeholders.newFile');
		if (action.value === 'rename') return target.value?.name ?? t('fileManager.modals.placeholders.newName');
		if (action.value === 'chmod') return value.value || '0755';
		return '';
	});
	const actionConfirmLabel = computed(() => {
		if (action.value === 'mkdir' || action.value === 'file') return t('fileManager.modals.buttons.create');
		if (action.value === 'rename') return t('fileManager.modals.buttons.rename');
		if (action.value === 'chmod') return t('fileManager.modals.buttons.changePermissions');
		return t('fileManager.modals.buttons.confirm');
	});
	const createNameConflict = computed(() => {
		if (action.value !== 'mkdir' && action.value !== 'file') return false;
		const name = value.value.trim();
		return Boolean(name && browser.entries.value.some((entry) => entry.name === name));
	});
	const actionConfirmDisabled = computed(() => {
		if (actionBusy.value) return true;
		const text = value.value.trim();
		if (!text) return true;
		if (createNameConflict.value) return true;
		if (action.value === 'rename' && text === target.value?.name) return true;
		if (action.value === 'chmod' && !/^[0-7]{3,4}$/.test(text)) return true;
		return false;
	});
	const compressSubmenu = ref<{ x: number; y: number; side: 'left' | 'right' } | null>(null);
	watch(context, (value) => {
		if (!value) compressSubmenu.value = null;
	});
	const FILE_MANAGER_SCALE_MIN = 0.5;
	const FILE_MANAGER_SCALE_MAX = 2;

	const renderedRowScale = ref(props.rowScale);
	const changingTerminalPath = ref(false);
	const syncingTerminalPath = ref(false);
	const listScrollTop = ref(0);
	const listViewportHeight = ref(600);
	const listViewportWidth = ref(800);
	const isCustomResized = ref(false);
	const FILE_VIRTUALIZATION_THRESHOLD = 250;
	const FILE_LIST_OVERSCAN = 12;
	let listResizeObserver: ReturnType<typeof useResizeObserver> | undefined;
	let disposed = false;
	type ColumnKey = 'name' | 'permissions' | 'modified';
	const minimumColumnWidths: Record<ColumnKey, number> = {
		name: 80,
		permissions: 90,
		modified: 108,
	};
	const defaultColumnWidths: Record<ColumnKey, number> = {
		name: 200,
		permissions: 98,
		modified: 136,
	};

	const initialColumnWidth = (key: ColumnKey): number => {
		const width = props.columnWidths?.[key];
		if (typeof width === 'number' && Number.isFinite(width)) {
			return Math.max(minimumColumnWidths[key], width);
		}
		return defaultColumnWidths[key];
	};

	const renderedColumnWidths = ref<Record<ColumnKey, number>>({
		name: initialColumnWidth('name'),
		permissions: initialColumnWidth('permissions'),
		modified: initialColumnWidth('modified'),
	});
	const showPermissions = computed(() => listViewportWidth.value >= 560);
	const showModified = computed(() => listViewportWidth.value >= 400);
	const isLarge = computed(() => showPermissions.value);
	const isMedium = computed(() => !showPermissions.value && showModified.value);
	const isSmall = computed(() => !showModified.value);
	const visibleColumnCount = computed(() => 1 + (showPermissions.value ? 1 : 0) + (showModified.value ? 1 : 0));
	const canResizeName = computed(() => !device.isMobile.value && (showPermissions.value || showModified.value));
	const canResizePermissions = computed(() => !device.isMobile.value && showModified.value);

	const totalColumnWidth = computed(() => {
		let sum = renderedColumnWidths.value.name;
		if (showPermissions.value) sum += renderedColumnWidths.value.permissions;
		if (showModified.value) sum += renderedColumnWidths.value.modified;
		return sum;
	});
	const isCurrentPathFavorite = computed(() =>
		catalog.favorites.value.some((item) => item.path === browser.path.value),
	);
	let activeColumnResize: { key: ColumnKey; pointerId: number; startX: number; startWidth: number } | undefined;
	let unregisterSearchFocus: (() => void) | undefined;
	let unregisterPathFocus: (() => void) | undefined;
	let navigationQueue: Promise<void> = Promise.resolve();
	let queuedRefresh: { promise: Promise<void>; draftRevision: number } | undefined;
	let clipboardPasteSerial = 0;
	let pendingDelete: symbol | undefined;
	let clipboardPasteTimer: number | undefined;
	const view = useAuthenticatedViewScope({
		available: () => props.active && props.connected && !props.connecting,

		onRevoke: clearIntents,
	});

	function clearIntents(): void {
		browser.cancelPrefetch();
		pendingDelete = undefined;
		clipboardPasteSerial++;
		changingTerminalPath.value = false;
		syncingTerminalPath.value = false;
		if (clipboardPasteTimer !== undefined) {
			window.clearTimeout(clipboardPasteTimer);
			clipboardPasteTimer = undefined;
		}
		action.value = null;
		context.value = null;
	}

	watch(() => props.channel, clearIntents);

	const enqueueNavigation = (operation: () => Promise<void>): Promise<void> => {
		queuedRefresh = undefined;
		const permission = view.capture();
		const channel = props.channel;

		const dispatch = () =>
			view.isCurrent(permission) && channel === props.channel ? operation() : Promise.resolve();

		const next = navigationQueue.then(dispatch, dispatch);
		navigationQueue = next.catch(() => undefined);
		return next;
	};

	const loadPath = async (path: string, draftRevision = pathDraftRevision): Promise<void> => {
		const permission = view.capture();
		if (permission.aborted) {
			return;
		}
		const loaded = await browser.load(path);
		if (view.isCurrent(permission) && loaded && (!pathDraftEditing.value || pathDraftRevision === draftRevision)) {
			pathDraft.value = browser.path.value;
		}
	};

	const refresh = async (): Promise<void> => {
		if (!props.connected || props.connecting) return;
		if (queuedRefresh) {
			queuedRefresh.draftRevision = pathDraftRevision;
			await queuedRefresh.promise;
			return;
		}
		const pending = { promise: Promise.resolve(), draftRevision: pathDraftRevision };
		pending.promise = enqueueNavigation(async () => {
			if (queuedRefresh === pending) queuedRefresh = undefined;
			await browser.refresh();
			if (!browser.error.value && (!pathDraftEditing.value || pathDraftRevision === pending.draftRevision)) {
				pathDraft.value = browser.path.value;
			}
		});
		queuedRefresh = pending;
		await pending.promise;
	};

	useWheelScale({
		target: () => listScroller.value,

		value: () => props.rowScale,

		scale: renderedRowScale,

		onChange: (scale) => emit('rowScale', scale),

		captureViewport: () => {
			const scroller = listScroller.value;
			if (!scroller || !shouldVirtualize.value) return;
			const entries = browser.visible.value;
			const anchoredRow = scroller.scrollTop / estimatedRowHeight.value;
			return () => {
				if (scroller !== listScroller.value || entries !== browser.visible.value) return;
				scroller.scrollTop = anchoredRow * estimatedRowHeight.value;
				listScrollTop.value = scroller.scrollTop;
			};
		},

		min: FILE_MANAGER_SCALE_MIN,
		max: FILE_MANAGER_SCALE_MAX,
		step: 0.08,
		thresholdPx: 72,
		maxStepsPerEvent: 3,
	});
	const rowStyle = computed(() => ({ '--file-row-scale': renderedRowScale.value }));
	const estimatedRowHeight = computed(() => Math.max(26, 41 * renderedRowScale.value));
	const shouldVirtualize = computed(() => browser.visible.value.length > FILE_VIRTUALIZATION_THRESHOLD);
	const virtualStartIndex = computed(() => {
		if (!shouldVirtualize.value) return 0;
		return Math.max(0, Math.floor(listScrollTop.value / estimatedRowHeight.value) - FILE_LIST_OVERSCAN);
	});
	const virtualEndIndex = computed(() => {
		if (!shouldVirtualize.value) return browser.visible.value.length;
		const visibleRows = Math.ceil(listViewportHeight.value / estimatedRowHeight.value);
		return Math.min(browser.visible.value.length, virtualStartIndex.value + visibleRows + FILE_LIST_OVERSCAN * 2);
	});
	const virtualEntries = computed(() => browser.visible.value.slice(virtualStartIndex.value, virtualEndIndex.value));
	const virtualTopPadding = computed(() =>
		shouldVirtualize.value ? virtualStartIndex.value * estimatedRowHeight.value : 0,
	);
	const virtualBottomPadding = computed(() =>
		shouldVirtualize.value
			? Math.max(0, (browser.visible.value.length - virtualEndIndex.value) * estimatedRowHeight.value)
			: 0,
	);

	const formatCompactModified = (value: string | number | Date): string => {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';

		const pad = (part: number) => String(part).padStart(2, '0');

		if (listViewportWidth.value < 360) {
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	};

	const formatModeOctal = (mode: number): string => (mode & 0o7777).toString(8).padStart(3, '0');

	const formatMode = (mode: number): string => {
		const permissions = mode & 0o777;
		return [
			permissions & 0o400 ? 'r' : '-',
			permissions & 0o200 ? 'w' : '-',
			permissions & 0o100 ? 'x' : '-',
			permissions & 0o040 ? 'r' : '-',
			permissions & 0o020 ? 'w' : '-',
			permissions & 0o010 ? 'x' : '-',
			permissions & 0o004 ? 'r' : '-',
			permissions & 0o002 ? 'w' : '-',
			permissions & 0o001 ? 'x' : '-',
		].join('');
	};

	const getFileIconClass = (filename: string): string => {
		const lower = filename.toLowerCase();
		const dot = lower.lastIndexOf('.');
		const extension = dot > 0 && dot < lower.length - 1 ? lower.slice(dot + 1) : dot === 0 ? lower.slice(1) : '';
		if (lower === 'makefile') return 'fas fa-cogs';
		if (lower === 'dockerfile' || lower.endsWith('docker-compose.yml') || lower.endsWith('docker-compose.yaml'))
			return 'fab fa-docker';
		if (lower === 'package.json' || lower === 'package-lock.json' || lower === 'pnpm-lock.yaml')
			return 'fab fa-npm';
		if (lower === 'yarn.lock') return 'fab fa-yarn';
		if (lower === 'composer.json' || lower === 'composer.lock') return 'fab fa-php';
		if (lower === 'gemfile' || lower === 'gemfile.lock') return 'fas fa-gem';
		if (lower.startsWith('.env')) return 'fas fa-shield-alt';
		if (['.git', '.gitignore', '.gitattributes', '.gitmodules'].includes(lower)) return 'fab fa-git-alt';
		if (lower === 'readme' || lower.startsWith('readme.')) return 'fas fa-book-reader';
		if (lower === 'license' || lower.startsWith('license.')) return 'fas fa-balance-scale';
		const iconMap: Record<string, string> = {
			jpg: 'fas fa-file-image',
			jpeg: 'fas fa-file-image',
			png: 'fas fa-file-image',
			gif: 'fas fa-file-image',
			bmp: 'fas fa-file-image',
			svg: 'fas fa-file-image',
			webp: 'fas fa-file-image',
			ico: 'fas fa-file-image',
			tiff: 'fas fa-file-image',
			mp4: 'fas fa-file-video',
			mkv: 'fas fa-file-video',
			avi: 'fas fa-file-video',
			mov: 'fas fa-file-video',
			webm: 'fas fa-file-video',
			mp3: 'fas fa-file-audio',
			wav: 'fas fa-file-audio',
			ogg: 'fas fa-file-audio',
			flac: 'fas fa-file-audio',
			doc: 'fas fa-file-word',
			docx: 'fas fa-file-word',
			xls: 'fas fa-file-excel',
			xlsx: 'fas fa-file-excel',
			ppt: 'fas fa-file-powerpoint',
			pptx: 'fas fa-file-powerpoint',
			pdf: 'fas fa-file-pdf',
			csv: 'fas fa-file-csv',
			tsv: 'fas fa-file-csv',
			zip: 'fas fa-file-archive',
			rar: 'fas fa-file-archive',
			tar: 'fas fa-file-archive',
			gz: 'fas fa-file-archive',
			'7z': 'fas fa-file-archive',
			bz2: 'fas fa-file-archive',
			xz: 'fas fa-file-archive',
			iso: 'fas fa-compact-disc',
			js: 'fab fa-js-square',
			mjs: 'fab fa-js-square',
			cjs: 'fab fa-js-square',
			jsx: 'fab fa-react',
			ts: 'fas fa-file-code',
			tsx: 'fab fa-react',
			vue: 'fab fa-vuejs',
			py: 'fab fa-python',
			java: 'fab fa-java',
			jar: 'fab fa-java',
			go: 'fas fa-file-code',
			rs: 'fas fa-file-code',
			c: 'fas fa-file-code',
			h: 'fas fa-file-code',
			cpp: 'fas fa-file-code',
			rb: 'fas fa-gem',
			php: 'fab fa-php',
			html: 'fab fa-html5',
			htm: 'fab fa-html5',
			css: 'fab fa-css3-alt',
			scss: 'fab fa-sass',
			sass: 'fab fa-sass',
			less: 'fab fa-less',
			json: 'fas fa-file-code',
			xml: 'fas fa-file-code',
			yml: 'fas fa-cog',
			yaml: 'fas fa-cog',
			ini: 'fas fa-cog',
			conf: 'fas fa-cog',
			toml: 'fas fa-cog',
			md: 'fab fa-markdown',
			markdown: 'fab fa-markdown',
			sql: 'fas fa-database',
			db: 'fas fa-database',
			sqlite: 'fas fa-database',
			sqlite3: 'fas fa-database',
			txt: 'fas fa-file-alt',
			text: 'fas fa-file-alt',
			log: 'fas fa-file-alt',
			key: 'fas fa-key',
			pem: 'fas fa-key',
			pub: 'fas fa-key',
			sh: 'fas fa-terminal',
			bash: 'fas fa-terminal',
			zsh: 'fas fa-terminal',
			fish: 'fas fa-terminal',
			bat: 'fas fa-terminal',
			cmd: 'fas fa-terminal',
			ps1: 'fas fa-terminal',
			ttf: 'fas fa-font',
			otf: 'fas fa-font',
			woff: 'fas fa-font',
			woff2: 'fas fa-font',
			bashrc: 'fas fa-cog',
			zshrc: 'fas fa-cog',
			profile: 'fas fa-cog',
			gitconfig: 'fab fa-git-alt',
		};
		return iconMap[extension] ?? 'far fa-file';
	};

	const selectedEntries = () => browser.visible.value.filter((entry) => browser.selected.value.has(entry.path));

	const joinPath = (basePath: string, name: string) => `${basePath.replace(/\/$/, '')}/${name}`.replace(/^\/\//, '/');

	const join = (name: string) => joinPath(browser.path.value, name);

	const parentOf = (path: string) => {
		const normalized = path.replace(/\/+$/, '') || '/';
		const index = normalized.lastIndexOf('/');
		return index <= 0 ? '/' : normalized.slice(0, index);
	};

	const isArchive = (entry: RemoteFileEntry) => /\.(zip|tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(entry.name);

	const canOpenAsText = (entry: RemoteFileEntry) =>
		!entry.metadata.isDirectory && /\.(md|markdown)$/i.test(entry.name);

	const displayEntryName = (entry: RemoteFileEntry) =>
		browser.searchActive.value && 'relativePath' in entry && typeof entry.relativePath === 'string'
			? entry.relativePath
			: entry.name;

	const sortDirectionLabel = computed(() =>
		browser.sortDirection.value === 'asc' ? t('fileManager.sort.ascending') : t('fileManager.sort.descending'),
	);
	const nameSortLabel = computed(() => `${t('fileManager.headers.name')} · ${sortDirectionLabel.value}`);

	const toggleSortDirection = () => {
		browser.sortDirection.value = browser.sortDirection.value === 'asc' ? 'desc' : 'asc';
	};

	const handleListScroll = () => {
		listScrollTop.value = listScroller.value?.scrollTop ?? 0;
	};

	const resetListScroll = () => {
		listScrollTop.value = 0;
		if (listScroller.value) listScroller.value.scrollTop = 0;
	};

	onMounted(async () => {
		unregisterSearchFocus = focusRegistry.register(
			'fileManagerSearch',
			() => {
				searchExpanded.value = true;
				void nextTick(() => searchInput.value?.focus?.());
				return true;
			},
			() => Boolean(root.value?.getClientRects().length),
		);
		unregisterPathFocus = focusRegistry.register(
			'fileManagerPathInput',
			() => {
				pathInput.value?.focus?.();
				pathInput.value?.select?.();
				return true;
			},
			() => Boolean(root.value?.getClientRects().length),
		);
		if (ownsFilesystemState) await filesystemState.ensureLoaded();
		if (disposed) return;
		pathDraft.value = browser.path.value;
		listResizeObserver = useResizeObserver(
			() => [root.value, listScroller.value],
			(entries) => {
				for (const entry of entries) {
					if (entry.target === root.value) {
						const width = entry.contentRect.width;
						if (width > 0) listViewportWidth.value = width;
					} else if (entry.target === listScroller.value) {
						const height = entry.contentRect.height;
						if (height > 0) listViewportHeight.value = height;
					}
				}
			},
		);
		await nextTick();
		if (disposed) return;
		if (root.value) {
			listViewportWidth.value = root.value.clientWidth || listViewportWidth.value;
		}
		if (listScroller.value) {
			listViewportHeight.value = listScroller.value.clientHeight || listViewportHeight.value;
		}
		document.addEventListener('mousedown', handleOutsideHistory);
	});
	const stopListScrollerWatch = watch(
		listScroller,
		(value) => {
			if (!listResizeObserver) return;

			if (value) {
				listViewportHeight.value = value.clientHeight || listViewportHeight.value;
			}
		},
		{ flush: 'post' },
	);

	const stopColumnResize = (event?: PointerEvent) => {
		if (!activeColumnResize) return;
		if (event && event.pointerId !== activeColumnResize.pointerId) return;
		activeColumnResize = undefined;
		window.removeEventListener('pointermove', moveColumnResize);
		window.removeEventListener('pointerup', stopColumnResize);
		window.removeEventListener('pointercancel', stopColumnResize);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		emit('columnWidths', { ...renderedColumnWidths.value });
	};

	function moveColumnResize(event: PointerEvent) {
		const current = activeColumnResize;
		if (!current || event.pointerId !== current.pointerId) return;
		isCustomResized.value = true;
		const minimum = minimumColumnWidths[current.key];
		const next = Math.max(minimum, Math.min(900, current.startWidth + event.clientX - current.startX));
		renderedColumnWidths.value = { ...renderedColumnWidths.value, [current.key]: Math.round(next) };
	}

	const startColumnResize = (event: PointerEvent, key: ColumnKey) => {
		if (!event.isPrimary || activeColumnResize) return;
		event.preventDefault();
		event.stopPropagation();
		activeColumnResize = {
			key,
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: renderedColumnWidths.value[key],
		};
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', moveColumnResize);
		window.addEventListener('pointerup', stopColumnResize);
		window.addEventListener('pointercancel', stopColumnResize);
	};

	const columnStyle = (key: ColumnKey) => {
		if (key === 'name') {
			if (!showModified.value || !isCustomResized.value) {
				return {
					minWidth: `${minimumColumnWidths.name}px`,
				};
			}
			return {
				width: `${renderedColumnWidths.value.name}px`,
				minWidth: `${minimumColumnWidths.name}px`,
			};
		}
		if (!isCustomResized.value) {
			if (key === 'permissions') {
				const w = listViewportWidth.value < 460 ? 90 : 98;
				return { width: `${w}px`, minWidth: `${minimumColumnWidths.permissions}px` };
			}
			if (key === 'modified') {
				const w = listViewportWidth.value < 360 ? 108 : 136;
				return { width: `${w}px`, minWidth: `${minimumColumnWidths.modified}px` };
			}
		}
		return {
			width: `${renderedColumnWidths.value[key]}px`,
			minWidth: `${minimumColumnWidths[key]}px`,
		};
	};

	let downloadLifetime = new AbortController();
	let downloadsActive = true;

	const invalidateDownloads = () => {
		downloadLifetime.abort();
		downloadLifetime = new AbortController();
	};

	watch(() => [props.channel, props.download], invalidateDownloads);
	onActivated(() => {
		downloadsActive = true;
	});
	onDeactivated(() => {
		downloadsActive = false;
		browser.cancelPrefetch();
		invalidateDownloads();
	});

	onBeforeUnmount(() => {
		disposed = true;
		browser.cancelPrefetch();
		stopLoadingWatch();
		if (loadingIndicatorTimer !== undefined) window.clearTimeout(loadingIndicatorTimer);
		downloadsActive = false;
		invalidateDownloads();
		document.removeEventListener('mousedown', handleOutsideHistory);
		unregisterSearchFocus?.();
		unregisterPathFocus?.();
		if (remoteDragScrollTimer !== undefined) {
			window.clearInterval(remoteDragScrollTimer);
			remoteDragScrollTimer = undefined;
		}
		if (pathHistoryCloseTimer !== undefined) window.clearTimeout(pathHistoryCloseTimer);
		if (ownsFilesystemState) filesystemState.dispose();
		stopListScrollerWatch();
		listResizeObserver?.stop();
		if (activeColumnResize) {
			activeColumnResize = undefined;
			window.removeEventListener('pointermove', moveColumnResize);
			window.removeEventListener('pointerup', stopColumnResize);
			window.removeEventListener('pointercancel', stopColumnResize);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		}
	});
	watch(browser.path, (path) => {
		if (!pathDraftEditing.value) pathDraft.value = path;
		keyboardCursor.value = null;
		resetListScroll();
	});
	watch(browser.searchQuery, () => {
		keyboardCursor.value = null;
		resetListScroll();
	});
	watch([browser.sortKey, browser.sortDirection], resetListScroll);
	watch(
		() => props.columnWidths,
		(value) => {
			if (!value || activeColumnResize) return;
			for (const key of Object.keys(minimumColumnWidths) as ColumnKey[]) {
				const width = value[key];
				if (Number.isFinite(width)) {
					renderedColumnWidths.value[key] = Math.max(minimumColumnWidths[key], Number(width));
				}
			}
		},
		{ deep: true },
	);

	const activate = async (entry: RemoteFileEntry): Promise<void> => {
		try {
			if (entry.metadata.isSymbolicLink) {
				const resolved = await props.channel.realpath(entry.path);
				if (resolved.targetType === 'directory') {
					await browser.load(resolved.path);
					return;
				}
				const name = resolved.path.split('/').pop() || entry.name;
				emit('openFile', {
					...entry,
					name,
					path: resolved.path,
					metadata: {
						...entry.metadata,
						isFile: true,
						isDirectory: false,
						isSymbolicLink: false,
					},
				});
				return;
			}
			if (entry.metadata.isDirectory) await browser.open(entry);
			else emit('openFile', entry);
		} catch (cause) {
			feedback.notifyError(
				entry.metadata.isSymbolicLink
					? t('fileManager.errors.readFileFailed')
					: cause instanceof Error
						? cause.message
						: String(cause),
			);
		}
	};

	const prefetchEntry = (entry: RemoteFileEntry): void => {
		if (!view.capture().aborted && entry.metadata.isDirectory && !entry.metadata.isSymbolicLink) {
			browser.prefetch(entry.path);
		}
	};

	const prefetchParent = (): void => {
		if (!view.capture().aborted && browser.path.value !== '/') {
			browser.prefetch(parentOf(browser.path.value));
		}
	};

	watch(keyboardCursor, (path) => {
		if (path === PARENT_CURSOR) {
			prefetchParent();
			return;
		}
		const entry = browser.visible.value.find((item) => item.path === path);
		if (entry) prefetchEntry(entry);
	});

	const openContextAt = (clientX: number, clientY: number, entry: RemoteFileEntry): void => {
		if (!browser.selected.value.has(entry.path)) browser.select(entry, 'only');
		context.value = { scope: 'entry', entry, x: clientX, y: clientY };
	};

	const contextEntries = (): RemoteFileEntry[] => {
		const entry = context.value?.scope === 'entry' ? context.value.entry : undefined;
		if (!entry) return [];
		if (!browser.selected.value.has(entry.path)) return [entry];
		const selected = selectedEntries();
		return selected.length ? selected : [entry];
	};

	const longPress = useLongPressGesture<RemoteFileEntry>({
		enabled: () => device.supportsTouchInteraction.value,

		vibrateMs: 15,

		onTrigger: (entry, point) => openContextAt(point.x, point.y, entry),
	});

	const clickEntry = (event: MouseEvent, entry: RemoteFileEntry) => {
		if (longPress.consumeClick(event)) return;
		keyboardCursor.value = entry.path;
		if (device.isMobile.value || device.hasTouch.value) {
			if (multiSelect.value) browser.select(entry, 'toggle');
			else void activate(entry);
			return;
		}
		listScroller.value?.focus({ preventScroll: true });
		if (event.ctrlKey || event.metaKey) {
			browser.select(entry, 'toggle');
			return;
		}
		if (event.shiftKey) {
			browser.select(entry, 'range');
			return;
		}
		browser.select(entry, 'only');
		if (entry.metadata.isDirectory) void activate(entry);
	};

	const doubleClickEntry = (event: MouseEvent, entry: RemoteFileEntry) => {
		if (device.isMobile.value || device.hasTouch.value || multiSelect.value) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || entry.metadata.isDirectory) return;
		event.preventDefault();
		event.stopPropagation();
		void activate(entry);
	};

	const focusFileListFromPointer = (event: PointerEvent): void => {
		const target = event.target;
		if (target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable="true"]'))
			return;
		listScroller.value?.focus({ preventScroll: true });
	};

	const PARENT_CURSOR = '__parent__';
	const keyboardPaths = computed(() => [
		...(browser.path.value === '/' ? [] : [PARENT_CURSOR]),
		...browser.visible.value.map((entry) => entry.path),
	]);

	const focusKeyboardCursor = async () => {
		const cursor = keyboardCursor.value;
		if (!cursor) return;
		if (cursor === PARENT_CURSOR) {
			root.value?.querySelector<HTMLElement>('[data-file-parent]')?.focus({ preventScroll: true });
			return;
		}
		const index = browser.visible.value.findIndex((entry) => entry.path === cursor);
		if (shouldVirtualize.value && index >= 0 && listScroller.value) {
			const targetTop = index * estimatedRowHeight.value;
			const targetBottom = targetTop + estimatedRowHeight.value;
			const viewportTop = listScroller.value.scrollTop;
			const viewportBottom = viewportTop + listScroller.value.clientHeight;
			if (targetTop < viewportTop || targetBottom > viewportBottom) {
				listScroller.value.scrollTop = Math.max(0, targetTop - listScroller.value.clientHeight / 2);
				listScrollTop.value = listScroller.value.scrollTop;
				await nextTick();
			}
		}
		const row = [...(root.value?.querySelectorAll<HTMLElement>('[data-file-path]') ?? [])].find(
			(element) => element.dataset.filePath === cursor,
		);
		row?.focus({ preventScroll: true });
		row?.closest('tr')?.scrollIntoView({ block: 'nearest' });
	};

	const ensureKeyboardSelection = (): RemoteFileEntry[] => {
		const selected = selectedEntries();
		if (selected.length) return selected;
		const cursor = keyboardCursor.value;
		if (!cursor || cursor === PARENT_CURSOR) return [];
		const entry = browser.visible.value.find((item) => item.path === cursor);
		if (!entry) return [];
		browser.select(entry, 'only');
		return [entry];
	};

	const isEditableTarget = (target: EventTarget | null): boolean =>
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable);

	const clipboardImageExtension = (mimeType: string): string => {
		const known: Record<string, string> = {
			'image/png': 'png',
			'image/jpeg': 'jpg',
			'image/webp': 'webp',
			'image/gif': 'gif',
			'image/bmp': 'bmp',
			'image/tiff': 'tiff',
			'image/svg+xml': 'svg',
			'image/avif': 'avif',
		};
		const exact = known[mimeType.toLowerCase()];
		if (exact) return exact;
		const subtype = mimeType
			.toLowerCase()
			.replace(/^image\//, '')
			.split('+')[0]
			?.replace(/[^a-z0-9]/g, '');
		return subtype || 'png';
	};

	const clipboardScreenshotStamp = (date: Date): string => {
		const pad = (value: number, length = 2) => String(value).padStart(length, '0');

		return [
			`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
			`${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`,
		].join('_');
	};

	const toClipboardImageFiles = (sourceFiles: readonly Blob[]): LocalUploadFile[] => {
		if (!sourceFiles.length) return [];
		const stamp = clipboardScreenshotStamp(new Date());
		return sourceFiles.map((file, index) => {
			const suffix = sourceFiles.length > 1 ? `_${index + 1}` : '';
			const type = file.type || 'image/png';
			const renamed = new File([file], `Screenshot_${stamp}${suffix}.${clipboardImageExtension(type)}`, {
				type,
				lastModified: Date.now(),
			});
			return { file: renamed };
		});
	};

	const eventClipboardImageFiles = (event: ClipboardEvent): LocalUploadFile[] => {
		const clipboard = event.clipboardData;
		if (!clipboard) return [];
		const itemFiles = Array.from(clipboard.items)
			.filter((item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((file): file is File => Boolean(file));
		const sourceFiles = itemFiles.length
			? itemFiles
			: Array.from(clipboard.files).filter((file) => file.type.toLowerCase().startsWith('image/'));
		return toClipboardImageFiles(sourceFiles);
	};

	const navigatorClipboardImageFiles = async (): Promise<LocalUploadFile[]> => {
		const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
		if (!clipboard || typeof clipboard.read !== 'function') return [];
		const items = await clipboard.read();
		const images: Blob[] = [];
		for (const item of items) {
			const imageType = item.types.find((type) => type.toLowerCase().startsWith('image/'));
			if (imageType) images.push(await item.getType(imageType));
		}
		return toClipboardImageFiles(images);
	};

	const handleClipboardPaste = (event: ClipboardEvent): void => {
		if (isEditableTarget(event.target) || view.capture().aborted) {
			return;
		}
		clipboardPasteSerial += 1;

		const imageFiles = eventClipboardImageFiles(event);
		if (imageFiles.length) {
			event.preventDefault();
			event.stopPropagation();
			emit('uploadFiles', browser.path.value, imageFiles, []);
			return;
		}

		if (props.clipboardCount) {
			event.preventDefault();
			event.stopPropagation();
			emit('paste', browser.path.value);
		}
	};

	const handleKeyboardPasteFallback = async (
		observedPasteSerial: number,
		destination: string,
		permission: AbortSignal,
		channel: FilesystemChannel,
	): Promise<void> => {
		const isCurrent = () =>
			view.isCurrent(permission) && channel === props.channel && clipboardPasteSerial === observedPasteSerial;

		if (!isCurrent()) {
			return;
		}
		try {
			const imageFiles = await navigatorClipboardImageFiles();
			if (!isCurrent()) {
				return;
			}
			if (imageFiles.length) {
				emit('uploadFiles', destination, imageFiles, []);
				return;
			}
		} catch {
			// A denied Clipboard API does not prevent the original live view's remote-file paste.
		}
		if (isCurrent() && props.clipboardCount) {
			emit('paste', destination);
		}
	};

	const handleKeyboardNavigation = (event: KeyboardEvent) => {
		if (isEditableTarget(event.target) || view.capture().aborted) return;

		const key = event.key.toLowerCase();
		const ctrlOrMeta = event.ctrlKey || event.metaKey;
		if (ctrlOrMeta && key === 'a') {
			event.preventDefault();
			browser.selectAll();
			return;
		}
		if (ctrlOrMeta && key === 'c') {
			event.preventDefault();
			const entries = ensureKeyboardSelection();
			if (entries.length) emit('copyToClipboard', entries);
			return;
		}
		if (ctrlOrMeta && key === 'x') {
			event.preventDefault();
			const entries = ensureKeyboardSelection();
			if (entries.length) emit('cutToClipboard', entries);
			return;
		}
		if (ctrlOrMeta && key === 'v') {
			// Do not preventDefault: the native paste event gets first chance to expose rich clipboard data.
			// Only if no paste event arrives do we fall back to the async Clipboard API.
			const observedPasteSerial = clipboardPasteSerial;
			const destination = browser.path.value;
			const permission = view.capture();
			const channel = props.channel;
			if (clipboardPasteTimer !== undefined) {
				window.clearTimeout(clipboardPasteTimer);
			}
			clipboardPasteTimer = window.setTimeout(() => {
				clipboardPasteTimer = undefined;
				void handleKeyboardPasteFallback(observedPasteSerial, destination, permission, channel);
			}, 0);
			return;
		}
		if (ctrlOrMeta && event.shiftKey && key === 'n') {
			event.preventDefault();
			begin('mkdir');
			return;
		}
		if (event.key === 'Delete') {
			event.preventDefault();
			const entries = ensureKeyboardSelection();
			if (entries.length) void remove(entries);
			return;
		}
		if (event.key === 'F2') {
			event.preventDefault();
			const entries = ensureKeyboardSelection();
			if (entries.length === 1) begin('rename', entries[0]);
			return;
		}
		if (event.key === 'F5') {
			event.preventDefault();
			void refresh();
			return;
		}
		if (event.altKey && event.key === 'ArrowUp' && browser.path.value !== '/') {
			event.preventDefault();
			void browser.goParent();
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') return;

		const paths = keyboardPaths.value;
		if (!paths.length) return;
		if (event.key === 'Enter') {
			const cursor = keyboardCursor.value ?? browser.selectionAnchor.value;
			if (!cursor) return;
			event.preventDefault();
			if (cursor === PARENT_CURSOR) void browser.goParent();
			else {
				const entry = browser.visible.value.find((item) => item.path === cursor);
				if (entry) void activate(entry);
			}
			return;
		}

		event.preventDefault();
		const current = keyboardCursor.value ?? browser.selectionAnchor.value;
		const currentIndex = current ? paths.indexOf(current) : -1;
		const delta = event.key === 'ArrowDown' ? 1 : -1;
		const nextIndex =
			currentIndex < 0
				? delta > 0
					? 0
					: paths.length - 1
				: (currentIndex + delta + paths.length) % paths.length;
		const next = paths[nextIndex]!;
		keyboardCursor.value = next;
		if (next !== PARENT_CURSOR) {
			const entry = browser.visible.value.find((item) => item.path === next);
			if (entry) browser.select(entry, 'only');
		}
		void nextTick(() => void focusKeyboardCursor());
	};

	const stopRemoteDragScroll = () => {
		remoteDragScrollDirection = 0;
		if (remoteDragScrollTimer === undefined) return;
		window.clearInterval(remoteDragScrollTimer);
		remoteDragScrollTimer = undefined;
	};

	const updateRemoteDragScroll = (event: DragEvent) => {
		const scroller = listScroller.value;
		if (!scroller || !draggedRemoteEntries.value.length || !remoteDragTarget.value) {
			stopRemoteDragScroll();
			return;
		}
		const rect = scroller.getBoundingClientRect();
		const edge = 48;
		const direction = event.clientY < rect.top + edge ? -1 : event.clientY > rect.bottom - edge ? 1 : 0;
		if (!direction) {
			stopRemoteDragScroll();
			return;
		}
		remoteDragScrollDirection = direction;
		if (remoteDragScrollTimer !== undefined) return;
		remoteDragScrollTimer = window.setInterval(() => {
			const currentScroller = listScroller.value;
			if (!currentScroller || !draggedRemoteEntries.value.length || !remoteDragTarget.value) {
				stopRemoteDragScroll();
				return;
			}
			currentScroller.scrollTop += remoteDragScrollDirection * 12;
		}, 30);
	};

	const remoteDropAllowed = (destination: string) =>
		draggedRemoteEntries.value.length > 0 &&
		draggedRemoteEntries.value.some((entry) => {
			if (entry.path === destination || parentOf(entry.path) === destination) return false;
			return !(entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`));
		});

	const startRemoteDrag = (event: DragEvent, entry: RemoteFileEntry) => {
		if (device.isMobile.value || !event.dataTransfer) return;
		const selection = selectedEntries();
		draggedRemoteEntries.value = browser.selected.value.has(entry.path) && selection.length ? selection : [entry];
		keyboardCursor.value = entry.path;
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData(
			'application/x-nexus-remote-files',
			draggedRemoteEntries.value.map((item) => item.path).join('\n'),
		);
	};

	const endRemoteDrag = () => {
		stopRemoteDragScroll();
		draggedRemoteEntries.value = [];
		remoteDragTarget.value = null;
	};

	const handleRemoteTargetDragOver = (event: DragEvent, destination: string) => {
		if (!remoteDropAllowed(destination)) {
			remoteDragTarget.value = null;
			stopRemoteDragScroll();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		remoteDragTarget.value = destination;
		updateRemoteDragScroll(event);
	};

	const clearRemoteDragTarget = (destination: string) => {
		if (remoteDragTarget.value !== destination) return;
		remoteDragTarget.value = null;
		stopRemoteDragScroll();
	};

	const dropRemote = (event: DragEvent, destination: string) => {
		if (!remoteDropAllowed(destination)) return;
		event.preventDefault();
		event.stopPropagation();
		const entries = draggedRemoteEntries.value.filter(
			(entry) =>
				entry.path !== destination &&
				parentOf(entry.path) !== destination &&
				!(entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`)),
		);
		endRemoteDrag();
		if (entries.length) emit('moveTo', entries, destination);
	};

	const handleDragEnter = (event: DragEvent) => {
		if (draggedRemoteEntries.value.length) return;
		if (event.dataTransfer?.types.includes('Files')) dragging.value = true;
	};

	const handleContainerDragOver = (event: DragEvent) => {
		if (draggedRemoteEntries.value.length) {
			updateRemoteDragScroll(event);
			return;
		}
		if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
	};

	const handleDragLeave = (event: DragEvent) => {
		const container = event.currentTarget as HTMLElement;
		const related = event.relatedTarget;
		if (!(related instanceof Node) || !container.contains(related)) dragging.value = false;
	};

	const toggleMultiSelect = () => {
		multiSelect.value = !multiSelect.value;
		browser.clearSelection();
	};

	const begin = (type: typeof action.value, entry?: RemoteFileEntry) => {
		action.value = type;
		target.value = entry ?? null;
		value.value =
			type === 'rename'
				? (entry?.name ?? '')
				: type === 'chmod'
					? formatModeOctal(entry?.metadata.mode ?? 0)
					: '';
		context.value = null;
	};

	const handleActionDialogOpenChange = (open: boolean) => {
		if (!open) action.value = null;
	};

	watch(
		action,
		async (type) => {
			const revision = ++actionRevision;
			actionBusy.value = false;
			if (!type) {
				return;
			}
			const permission = view.capture();
			await nextTick();
			if (!view.isCurrent(permission) || revision !== actionRevision) {
				return;
			}
			actionInput.value?.focus?.();
			actionInput.value?.select?.();
		},
		{ flush: 'sync' },
	);

	const submit = async () => {
		const permission = view.capture();
		if (permission.aborted || actionConfirmDisabled.value) {
			return;
		}
		const channel = props.channel;
		const revision = actionRevision;
		const type = action.value;
		const entry = target.value;
		const text = value.value.trim();
		const path = join(text);

		const isCurrent = () => view.isCurrent(permission) && channel === props.channel && revision === actionRevision;

		actionBusy.value = true;
		try {
			if (type === 'mkdir') {
				await channel.createDirectory(path);
			} else if (type === 'file') {
				await channel.createFile(path, '');
			} else if ((type === 'rename' || type === 'chmod') && entry) {
				if (props.beforeFileMutation && !props.beforeFileMutation([entry.path])) {
					return;
				}
				if (type === 'rename') {
					await channel.rename(entry.path, joinPath(parentOf(entry.path), text));
				} else {
					await channel.chmod(entry.path, Number.parseInt(text, 8));
				}
			} else {
				return;
			}
			if (!isCurrent()) {
				return;
			}
			action.value = null;
			await browser.load();
		} catch (cause) {
			if (isCurrent()) {
				const detail = filesystemFailureMessage(cause, t);
				feedback.notifyError(type === 'chmod' ? t('fileManager.errors.chmodFailed') + ': ' + detail : detail);
			}
		} finally {
			if (isCurrent()) {
				actionBusy.value = false;
			}
		}
	};

	const remove = async (entries: RemoteFileEntry[]): Promise<void> => {
		const permission = view.capture();
		const first = entries[0];
		if (!first || permission.aborted || pendingDelete) {
			return;
		}
		const channel = props.channel;
		const paths = entries.map((entry) => entry.path);
		const directories = entries.filter((entry) => entry.metadata.isDirectory).map((entry) => entry.path);
		const key =
			entries.length > 1
				? 'fileManager.prompts.confirmDeleteMultiple'
				: first.metadata.isDirectory
					? 'fileManager.prompts.confirmDeleteFolder'
					: 'fileManager.prompts.confirmDeleteFile';
		const params = entries.length > 1 ? { count: entries.length } : { name: first.name };

		const isCurrent = () => view.isCurrent(permission) && channel === props.channel;

		context.value = null;
		const deletion = Symbol();
		pendingDelete = deletion;
		try {
			if (
				props.confirmDelete &&
				!(await feedback.confirm({ message: t(key, params), destructive: true, signal: permission }))
			) {
				return;
			}
			if (!isCurrent() || (props.beforeFileMutation && !props.beforeFileMutation(paths))) {
				return;
			}
			await channel.remove(paths, { forceDirectoryPaths: directories });
			if (isCurrent()) {
				await browser.load();
			}
		} catch (cause) {
			if (isCurrent()) {
				feedback.notifyError(t('fileManager.errors.deletePartial') + ': ' + filesystemFailureMessage(cause, t));
				await browser.load().catch(() => undefined);
			}
		} finally {
			if (pendingDelete === deletion) {
				pendingDelete = undefined;
			}
		}
	};

	const terminalDirectoryErrorMessage = (cause: unknown): string => {
		const isUnknownResult =
			cause instanceof TerminalDirectoryFailure &&
			cause.code !== 'not_connected' &&
			cause.code !== 'invalid_input' &&
			cause.code !== 'directory_unchanged';
		return t(
			isUnknownResult
				? 'fileManager.errors.terminalPathChangeUnknown'
				: 'fileManager.errors.terminalPathChangeFailed',
		);
	};

	const changeTerminalPath = async (path: string): Promise<void> => {
		const permission = view.capture();
		const directory = props.terminalDirectory;
		if (!directory || permission.aborted || changingTerminalPath.value) {
			return;
		}

		const isCurrent = () => view.isCurrent(permission) && directory === props.terminalDirectory;

		changingTerminalPath.value = true;
		try {
			await directory.changeDirectory(path);
		} catch (cause) {
			if (isCurrent()) {
				feedback.notifyError(terminalDirectoryErrorMessage(cause));
			}
		} finally {
			if (isCurrent()) {
				changingTerminalPath.value = false;
			}
		}
	};

	const changeTerminalToCurrent = () => {
		if (browser.loading.value) {
			return;
		}
		return changeTerminalPath(browser.path.value);
	};

	const openPathHistory = async () => {
		catalogVisible.value = false;
		if (pathHistoryCloseTimer !== undefined) {
			window.clearTimeout(pathHistoryCloseTimer);
			pathHistoryCloseTimer = undefined;
		}
		pathHistoryOpen.value = true;
		pathHistoryIndex.value = -1;
		catalog.historySearch.value = pathDraft.value;
		await catalog.loadHistory(true).catch(() => undefined);
	};

	const closePathHistory = (restore = false) => {
		if (pathHistoryCloseTimer !== undefined) {
			window.clearTimeout(pathHistoryCloseTimer);
			pathHistoryCloseTimer = undefined;
		}
		pathHistoryOpen.value = false;
		pathHistoryIndex.value = -1;
		if (restore) pathDraft.value = browser.path.value;
	};

	const handleOutsideHistory = (event: MouseEvent) => {
		if (!pathHistoryOpen.value) return;
		const target = event.target as Node | null;
		const pathInputEl = pathInput.value as unknown as HTMLElement | null;
		const pathContainer = pathInputEl?.closest('.file-manager-path-input');
		if (pathContainer && target && pathContainer.contains(target)) return;
		closePathHistory();
	};

	const togglePathHistory = () => {
		if (pathHistoryOpen.value) {
			closePathHistory();
		} else {
			catalogVisible.value = false;
			void openPathHistory();
		}
	};

	const toggleCatalog = () => {
		if (catalogVisible.value) {
			catalogVisible.value = false;
		} else {
			closePathHistory();
			catalogVisible.value = true;
		}
	};

	const updatePathHistorySearch = () => {
		pathDraftRevision += 1;
		catalog.historySearch.value = pathDraft.value;
		pathHistoryIndex.value = -1;
	};

	const beginPathEditing = () => {
		catalogVisible.value = false;
		pathDraftEditing.value = true;
		void openPathHistory();
	};

	const endPathEditing = () => {
		pathDraftEditing.value = false;
		deferClosePathHistory();
	};

	const deferClosePathHistory = () => {
		if (pathHistoryCloseTimer !== undefined) window.clearTimeout(pathHistoryCloseTimer);
		pathHistoryCloseTimer = window.setTimeout(() => {
			pathHistoryCloseTimer = undefined;
			closePathHistory();
		}, 120);
	};

	const navigatePathDraft = async (path = pathDraft.value) => {
		if (!path.trim()) return;
		const draftRevision = pathDraftRevision;
		closePathHistory();
		await enqueueNavigation(() => loadPath(path, draftRevision));
	};

	const handlePathInputKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			closePathHistory(true);
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!pathHistoryOpen.value) void openPathHistory();
			const length = catalog.filteredHistory.value.length;
			if (!length) return;
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			pathHistoryIndex.value =
				pathHistoryIndex.value < 0
					? delta > 0
						? 0
						: length - 1
					: (pathHistoryIndex.value + delta + length) % length;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const selected = catalog.filteredHistory.value[pathHistoryIndex.value];
			void navigatePathDraft(selected?.path ?? pathDraft.value);
		}
	};

	const copyHistoryPath = async (path: string) => {
		try {
			await writeClipboardText(path);
			feedback.notifySuccess(t('pathHistory.copiedSuccess'));
		} catch {
			feedback.notifyError(t('pathHistory.copiedError'));
		}
	};

	const removeHistoryPath = async (id: number) => {
		await catalog.removeHistory(id);
		const length = catalog.filteredHistory.value.length;
		if (!length) pathHistoryIndex.value = -1;
		else pathHistoryIndex.value = Math.min(pathHistoryIndex.value, length - 1);
	};

	const openSearch = () => {
		searchExpanded.value = true;
		void nextTick(() => searchInput.value?.focus?.());
	};

	const closeSearch = () => {
		browser.clearSearch();
		searchExpanded.value = false;
	};

	const syncFromTerminal = async (): Promise<void> => {
		const permission = view.capture();
		const directory = props.terminalDirectory;
		if (!directory || permission.aborted || syncingTerminalPath.value) {
			return;
		}

		const isCurrent = () => view.isCurrent(permission) && directory === props.terminalDirectory;

		syncingTerminalPath.value = true;
		const draftRevision = pathDraftRevision;
		try {
			await enqueueNavigation(async () => {
				const path = await directory.readCurrentDirectory();
				if (isCurrent() && path) {
					await loadPath(path, draftRevision);
				}
			});
		} catch (cause) {
			if (isCurrent()) {
				feedback.notifyError(filesystemFailureMessage(cause, t));
			}
		} finally {
			if (isCurrent()) {
				syncingTerminalPath.value = false;
			}
		}
	};

	const navigate = async (path: string) => {
		const draftRevision = pathDraftRevision;
		await enqueueNavigation(() => loadPath(path, draftRevision));
	};

	const sendPathToTerminal = (path: string) => changeTerminalPath(path);

	const download = async (entries: RemoteFileEntry[]) => {
		context.value = null;
		const downloadPort = props.download;
		if (!downloadPort || !entries.length || !downloadsActive) return;
		const lifetime = downloadLifetime;
		const permission = view.capture();
		const channel = props.channel;

		const isCurrent = () =>
			downloadsActive &&
			view.isCurrent(permission) &&
			!lifetime.signal.aborted &&
			lifetime === downloadLifetime &&
			props.channel === channel &&
			props.download === downloadPort;

		if (!isCurrent()) {
			return;
		}
		await Promise.all(
			entries.map(async (entry) => {
				try {
					let path = entry.path;
					let kind: 'file' | 'directory' = entry.metadata.isDirectory ? 'directory' : 'file';
					if (entry.metadata.isSymbolicLink) {
						const resolved = await channel.realpath(entry.path);
						if (!isCurrent()) return;
						path = resolved.path;
						kind = resolved.targetType === 'directory' ? 'directory' : 'file';
					}
					const { url } = await downloadPort.createDownload(
						path,
						kind,
						AbortSignal.any([lifetime.signal, permission]),
					);
					if (!isCurrent()) return;
					const anchor = document.createElement('a');
					anchor.href = url;
					anchor.download = '';
					anchor.rel = 'noopener';
					document.body.append(anchor);
					anchor.click();
					anchor.remove();
				} catch (cause) {
					if (isCurrent()) feedback.notifyError(filesystemFailureMessage(cause, t));
				}
			}),
		);
	};

	const copyPath = async (entry: RemoteFileEntry) => {
		context.value = null;
		try {
			await writeClipboardText(entry.path);
			feedback.notifySuccess(t('fileManager.notifications.pathCopied'));
		} catch {
			feedback.notifyError(t('fileManager.errors.copyPathFailed'));
		}
	};

	const openContext = (event: MouseEvent, entry: RemoteFileEntry) => {
		event.preventDefault();
		if (!browser.selected.value.has(entry.path) && !event.ctrlKey && !event.metaKey && !event.shiftKey)
			browser.select(entry, 'only');
		if (device.supportsTouchInteraction.value) longPress.suppressClick();
		compressSubmenu.value = null;
		context.value = { scope: 'entry', entry, x: event.clientX, y: event.clientY };
	};

	const openDirectoryContext = (
		event: MouseEvent,
		scope: 'current-directory' | 'parent-directory',
		destination: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		browser.clearSelection();
		compressSubmenu.value = null;
		context.value = { scope, destination, x: event.clientX, y: event.clientY };
	};

	const openCompressSubmenu = (event: Event) => {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const width = 220;
		const margin = 8;
		const side = rect.right + width <= window.innerWidth - margin ? 'right' : 'left';
		compressSubmenu.value = {
			x: side === 'right' ? rect.right : Math.max(margin, rect.left - width),
			y: rect.top,
			side,
		};
	};

	const compressWithPreset = (format: ArchiveCompressionFormat, passwordProtected = false) => {
		const entries = contextEntries();
		if (!entries.length) return;
		emit('compressPreset', { entries, format, ...(passwordProtected ? { passwordProtected: true } : {}) });
		compressSubmenu.value = null;
		context.value = null;
	};

	const contextAction = (kind: 'open' | 'copy' | 'move' | 'compress' | 'decompress') => {
		const entry = context.value?.scope === 'entry' ? context.value.entry : undefined;
		const entries = contextEntries();
		context.value = null;
		if (!entry) return;
		if (kind === 'open') void activate(entry);
		else if (kind === 'copy') emit('copyToClipboard', entries);
		else if (kind === 'move') emit('cutToClipboard', entries);
		else if (kind === 'compress') emit('compress', entries);
		else if (kind === 'decompress') emit('decompress', entry);
	};

	const dropFiles = async (event: DragEvent) => {
		const permission = view.capture();
		if (permission.aborted) return;
		if (draggedRemoteEntries.value.length) {
			endRemoteDrag();
			return;
		}
		dragging.value = false;
		const dataTransfer = event.dataTransfer;
		if (!dataTransfer) return;
		try {
			const batch = await collectDroppedLocalFiles(dataTransfer);
			if (!view.isCurrent(permission)) return;
			if (batch.files.length || batch.directories.length) {
				emit('uploadFiles', browser.path.value, batch.files, batch.directories);
			}
		} catch (cause) {
			if (view.isCurrent(permission)) feedback.notifyError(filesystemFailureMessage(cause, t));
		}
	};
</script>

<template>
	<section
		ref="root"
		:aria-busy="loading"
		class="file-manager-root relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm text-foreground"
		:class="{
			'is-mobile': device.isMobile.value,
			'is-size-large': isLarge,
			'is-size-medium': isMedium,
			'is-size-small': isSmall,
		}"
		@click="context = null"
		@keydown="handleKeyboardNavigation"
		@paste="handleClipboardPaste"
		@dragenter="handleDragEnter"
		@dragover="handleContainerDragOver"
		@dragleave="handleDragLeave"
		@drop.prevent="dropFiles"
	>
		<header
			v-if="props.connected || props.connecting"
			class="file-manager-toolbar"
			:inert="!props.connected || props.connecting"
		>
			<div class="file-manager-path-row">
				<div class="file-manager-path-input">
					<i class="fas fa-folder file-manager-path-icon" aria-hidden="true"></i>
					<input
						ref="pathInput"
						data-no-highlight
						v-model="pathDraft"
						data-focus-id="fileManagerPathInput"
						type="text"
						class="file-manager-path-field"
						:title="t('fileManager.editPathTooltip')"
						@focus="beginPathEditing"
						@click="openPathHistory"
						@input="updatePathHistorySearch"
						@keydown="handlePathInputKeydown"
						@blur="endPathEditing"
					/>
					<button
						type="button"
						class="file-manager-path-tool file-manager-name-sort"
						:title="nameSortLabel"
						:aria-label="nameSortLabel"
						@click.stop="toggleSortDirection"
					>
						<i
							class="fas"
							:class="browser.sortDirection.value === 'asc' ? 'fa-sort-alpha-down' : 'fa-sort-alpha-up'"
							aria-hidden="true"
						></i>
					</button>
					<button
						ref="favoriteButton"
						type="button"
						class="file-manager-path-tool file-manager-path-favorite-btn"
						:class="{ 'is-active': isCurrentPathFavorite }"
						:title="t('favoritePaths.title')"
						:aria-label="t('favoritePaths.title')"
						:aria-pressed="isCurrentPathFavorite"
						@mousedown.prevent
						@click.stop="toggleCatalog"
					>
						<i class="fas fa-star" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="file-manager-path-tool file-manager-path-history-btn"
						:class="{ 'is-active': pathHistoryOpen }"
						:title="t('pathHistory.title')"
						:aria-label="t('pathHistory.title')"
						:aria-expanded="pathHistoryOpen"
						@mousedown.prevent
						@click.stop="togglePathHistory"
					>
						<i class="fas fa-chevron-down" aria-hidden="true"></i>
					</button>
					<PathHistoryDropdown
						:visible="pathHistoryOpen"
						:loading="catalog.loadingHistory.value"
						:items="catalog.filteredHistory.value"
						:selected-index="pathHistoryIndex"
						@select="navigatePathDraft"
						@copy="copyHistoryPath"
						@remove="removeHistoryPath"
					/>
				</div>
			</div>

			<div v-if="!searchExpanded" class="file-manager-actions">
				<button
					type="button"
					class="file-manager-action-button"
					:disabled="!props.terminalDirectory || changingTerminalPath || browser.loading.value"
					:title="t('fileManager.actions.cdToTerminal')"
					:aria-label="t('fileManager.actions.cdToTerminal')"
					@click.stop="changeTerminalToCurrent"
				>
					<UiSpinner v-if="changingTerminalPath" density="compact" />
					<i v-else class="fas fa-terminal" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="file-manager-action-button"
					:disabled="!props.terminalDirectory || syncingTerminalPath"
					:title="t('fileManager.actions.syncFromTerminalPath')"
					:aria-label="t('fileManager.actions.syncFromTerminalPath')"
					@click.stop="syncFromTerminal"
				>
					<UiSpinner v-if="syncingTerminalPath" density="compact" />
					<i v-else class="fas fa-folder-open" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="file-manager-action-button"
					:title="t('fileManager.actions.refresh')"
					:aria-label="t('fileManager.actions.refresh')"
					@click.stop="refresh"
				>
					<UiSpinner v-if="showLoading" density="compact" />
					<i v-else class="fas fa-sync-alt" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="file-manager-action-button"
					:title="t('fileManager.searchPlaceholder')"
					:aria-label="t('fileManager.searchPlaceholder')"
					@click.stop="openSearch"
				>
					<i class="fas fa-search" aria-hidden="true"></i>
				</button>
				<button
					v-if="showEditorButton"
					type="button"
					class="file-manager-action-button"
					:title="t('fileManager.actions.openEditor')"
					:aria-label="t('fileManager.actions.openEditor')"
					@click="emit('openEditor')"
				>
					<i class="far fa-edit" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="file-manager-action-button"
					:title="t('fileManager.actions.uploadFile')"
					:aria-label="t('fileManager.actions.uploadFile')"
					@click="emit('upload', browser.path.value)"
				>
					<i class="fas fa-upload" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="file-manager-action-button"
					:title="t('fileManager.actions.newFolder')"
					:aria-label="t('fileManager.actions.newFolder')"
					@click="begin('mkdir')"
				>
					<i class="fas fa-folder-plus" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="file-manager-action-button"
					:title="t('fileManager.actions.newFile')"
					:aria-label="t('fileManager.actions.newFile')"
					@click="begin('file')"
				>
					<i class="far fa-file-alt" aria-hidden="true"></i>
				</button>
				<button
					v-if="device.isMobile.value || device.hasTouch.value"
					type="button"
					class="file-manager-action-button"
					:class="{ 'is-active': multiSelect }"
					:title="
						multiSelect ? t('fileManager.actions.exitMultiSelect') : t('fileManager.actions.multiSelect')
					"
					:aria-label="
						multiSelect ? t('fileManager.actions.exitMultiSelect') : t('fileManager.actions.multiSelect')
					"
					:aria-pressed="multiSelect"
					@click="toggleMultiSelect"
				>
					<i class="fas fa-check-square" aria-hidden="true"></i>
				</button>
			</div>

			<div v-else class="file-manager-search-row">
				<div class="file-manager-search-box">
					<i class="fas fa-search file-manager-search-icon" aria-hidden="true"></i>
					<input
						ref="searchInput"
						data-no-highlight
						v-model="browser.searchQuery.value"
						data-focus-id="fileManagerSearch"
						type="text"
						class="file-manager-search-input"
						:placeholder="t('fileManager.searchPlaceholder')"
						@keyup.enter="browser.search"
						@keyup.esc="closeSearch"
						@blur="!browser.searchQuery.value && (searchExpanded = false)"
					/>
					<button
						type="button"
						class="file-manager-search-clear"
						:title="browser.searchQuery.value ? t('common.clear') : t('common.close')"
						:aria-label="browser.searchQuery.value ? t('common.clear') : t('common.close')"
						@mousedown.prevent
						@click.stop="browser.searchQuery.value ? browser.clearSearch() : closeSearch()"
					>
						<i class="fas fa-times" aria-hidden="true"></i>
					</button>
				</div>
			</div>
		</header>

		<div
			v-if="
				props.connecting ||
				(props.connected && ((!browser.loaded.value && !browser.error.value) || browser.searching.value))
			"
			class="file-manager-connection-state"
		>
			<UiLoadingState
				dense
				:bordered="false"
				:title="props.connecting ? t('fileManager.connecting') : t('fileManager.loading')"
			/>
		</div>
		<div v-else-if="props.connected && browser.error.value" class="file-manager-error-state">
			<UiInlineNotice tone="danger" compact>
				{{ filesystemFailureMessage(browser.error.value, t) }}
				<template #actions>
					<UiButton appearance="ghost" density="compact" @click="refresh">
						<i class="fas fa-sync-alt" aria-hidden="true"></i>
						{{ t('fileManager.actions.refresh') }}
					</UiButton>
				</template>
			</UiInlineNotice>
		</div>
		<div v-else-if="props.connected" class="relative flex min-h-0 flex-1 flex-col">
			<div
				ref="listScroller"
				tabindex="0"
				:aria-label="t('fileManager.modalTitle')"
				:aria-busy="browser.loading.value"
				class="file-manager-list min-h-0 flex-1 overflow-auto outline-none"
				:style="[rowStyle, { overflowAnchor: shouldVirtualize ? 'none' : undefined }]"
				:data-row-scale="renderedRowScale.toFixed(2)"
				@scroll="handleListScroll"
				@pointerdown="focusFileListFromPointer"
				@contextmenu="openDirectoryContext($event, 'current-directory', browser.path.value)"
			>
				<UiInlineNotice v-if="browser.searchError.value" class="file-manager-notice" tone="danger" compact>
					{{ filesystemFailureMessage(browser.searchError.value, t) }}
				</UiInlineNotice>
				<UiInlineNotice
					v-if="browser.searchActive.value && browser.searchTruncated.value"
					class="file-manager-notice"
					tone="warning"
					compact
				>
					{{ t('fileManager.searchTruncated') }}
				</UiInlineNotice>
				<table
					class="file-table w-full table-fixed"
					:class="{ 'is-virtualized': shouldVirtualize }"
					:style="{ minWidth: isCustomResized && showModified ? `${totalColumnWidth}px` : '100%' }"
				>
					<colgroup>
						<col class="file-col-name" :style="columnStyle('name')" />
						<col v-if="showPermissions" class="file-col-permissions" :style="columnStyle('permissions')" />
						<col v-if="showModified" class="file-col-modified" :style="columnStyle('modified')" />
					</colgroup>
					<thead
						v-if="canResizeName || canResizePermissions"
						class="file-table-head file-table-head--resize-only"
						aria-hidden="true"
					>
						<tr>
							<th class="file-table-header file-table-header-name" :style="columnStyle('name')">
								<span
									v-if="canResizeName"
									class="file-column-resizer"
									@pointerdown="startColumnResize($event, 'name')"
								></span>
							</th>
							<th
								v-if="showPermissions"
								class="file-table-header file-table-header-permissions"
								:style="columnStyle('permissions')"
							>
								<span
									v-if="canResizePermissions"
									class="file-column-resizer"
									@pointerdown="startColumnResize($event, 'permissions')"
								></span>
							</th>
							<th
								v-if="showModified"
								class="file-table-header file-table-header-modified"
								:style="columnStyle('modified')"
							></th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-if="browser.path.value !== '/'"
							data-filename=".."
							data-file-parent
							tabindex="-1"
							@pointerenter="prefetchParent"
							@pointerleave="browser.cancelPrefetch()"
							class="file-row file-row--parent"
							:class="{
								'is-selected': keyboardCursor === PARENT_CURSOR,
								'is-drop-target': remoteDragTarget === parentOf(browser.path.value),
							}"
							@click="
								keyboardCursor = PARENT_CURSOR;
								browser.goParent();
							"
							@dragover="handleRemoteTargetDragOver($event, parentOf(browser.path.value))"
							@dragleave="clearRemoteDragTarget(parentOf(browser.path.value))"
							@drop="dropRemote($event, parentOf(browser.path.value))"
							@contextmenu.stop="
								openDirectoryContext($event, 'parent-directory', parentOf(browser.path.value))
							"
						>
							<td class="file-row-cell file-row-name">
								<span class="file-row-parent-content">
									<i class="file-row-icon fas fa-level-up-alt" aria-hidden="true"></i>
									<span class="file-row-name-label">..</span>
								</span>
							</td>
							<td v-if="showPermissions" class="file-row-cell file-row-permissions"></td>
							<td v-if="showModified" class="file-row-cell file-row-modified"></td>
						</tr>
						<tr v-if="browser.visible.value.length === 0">
							<td :colspan="visibleColumnCount">
								<UiEmptyState
									class="file-manager-empty-state"
									compact
									:bordered="false"
									:icon="browser.searchQuery.value ? 'fas fa-search' : 'far fa-folder-open'"
									:title="
										browser.searchQuery.value
											? t('fileManager.noSearchResults')
											: t('fileManager.emptyDirectory')
									"
								/>
							</td>
						</tr>
						<tr v-if="virtualTopPadding" aria-hidden="true">
							<td
								:colspan="visibleColumnCount"
								class="file-virtual-spacer"
								:style="{ height: `${virtualTopPadding}px` }"
							></td>
						</tr>
						<tr
							v-for="entry in virtualEntries"
							:key="entry.path"
							:data-filename="entry.name"
							:data-file-path="entry.path"
							tabindex="-1"
							class="file-row"
							:class="{
								'is-selected': browser.selected.value.has(entry.path),
								'is-drop-target': remoteDragTarget === entry.path,
								'is-navigable':
									entry.metadata.isDirectory ||
									entry.metadata.isFile ||
									entry.metadata.isSymbolicLink,
							}"
							:draggable="!device.isMobile.value"
							@dragstart="startRemoteDrag($event, entry)"
							@dragend="endRemoteDrag"
							@dragover="entry.metadata.isDirectory && handleRemoteTargetDragOver($event, entry.path)"
							@dragleave="clearRemoteDragTarget(entry.path)"
							@drop="entry.metadata.isDirectory && dropRemote($event, entry.path)"
							@contextmenu.stop="openContext($event, entry)"
							@click="clickEntry($event, entry)"
							@dblclick="doubleClickEntry($event, entry)"
							@pointerdown="longPress.start($event, entry)"
							@pointerenter="prefetchEntry(entry)"
							@pointerleave="browser.cancelPrefetch()"
							@pointermove="longPress.move"
							@pointerup="longPress.end"
							@pointercancel="longPress.cancel"
						>
							<td
								class="file-row-cell file-row-name"
								:class="{ 'is-directory': entry.metadata.isDirectory }"
							>
								<div class="file-row-name-container">
									<i
										:class="[
											'file-row-icon',
											entry.metadata.isDirectory
												? 'fas fa-folder'
												: entry.metadata.isSymbolicLink
													? 'fas fa-link'
													: getFileIconClass(entry.name),
										]"
										aria-hidden="true"
									></i>
									<button type="button" class="file-row-name-button" :data-file-path="entry.path">
										<span class="file-row-name-label">{{ displayEntryName(entry) }}</span>
									</button>
								</div>
							</td>
							<td v-if="showPermissions" class="file-row-cell file-row-permissions">
								{{ formatMode(entry.metadata.mode) }}
							</td>
							<td
								v-if="showModified"
								class="file-row-cell file-row-modified"
								:title="new Date(entry.metadata.modifiedAt).toLocaleString()"
							>
								{{ formatCompactModified(entry.metadata.modifiedAt) }}
							</td>
						</tr>
						<tr v-if="virtualBottomPadding" aria-hidden="true">
							<td
								:colspan="visibleColumnCount"
								class="file-virtual-spacer"
								:style="{ height: `${virtualBottomPadding}px` }"
							></td>
						</tr>
					</tbody>
				</table>
			</div>
			<div v-if="showLoading" class="file-manager-loading-state">
				<UiInlineLoading :label="t('fileManager.loading')" />
			</div>
		</div>

		<div v-if="dragging" class="file-manager-drop-state">
			<i class="fas fa-cloud-arrow-up" aria-hidden="true"></i>
			<span>{{ t('fileManager.dropFilesHere') }}</span>
		</div>

		<UiContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" auto-width @close="context = null">
			<template v-if="context.scope === 'entry'">
				<template v-if="device.isMobile.value || device.hasTouch.value">
					<UiContextMenuItem v-if="download" @click="download(contextEntries())">
						{{ contextDownloadLabel }}
					</UiContextMenuItem>
					<UiContextMenuItem class="justify-between gap-4" @click="contextAction('move')">
						<span>{{ t('fileManager.actions.cut') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.cut }}</span>
					</UiContextMenuItem>
					<UiContextMenuItem class="justify-between gap-4" @click="contextAction('copy')">
						<span>{{ t('fileManager.actions.copy') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.copy }}</span>
					</UiContextMenuItem>
					<UiContextMenuItem
						v-if="props.clipboardCount"
						class="justify-between gap-4"
						@click="
							emit('paste', browser.path.value);
							context = null;
						"
					>
						<span>{{ t('fileManager.actions.paste') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.paste }}</span>
					</UiContextMenuItem>
					<UiContextMenuItem @click="copyPath(context.entry)">
						{{ t('fileManager.actions.copyPath') }}
					</UiContextMenuItem>

					<div class="mx-1 my-1 border-t border-border/50" role="separator"></div>

					<UiContextMenuItem class="justify-between gap-4" @click="remove(contextEntries())">
						<span>{{ t('fileManager.actions.delete') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.delete }}</span>
					</UiContextMenuItem>
					<UiContextMenuItem class="justify-between gap-4" @click="begin('rename', context.entry)">
						<span>{{ t('fileManager.actions.rename') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.rename }}</span>
					</UiContextMenuItem>

					<div class="mx-1 my-1 border-t border-border/50" role="separator"></div>

					<UiContextMenuItem @click="compressWithPreset('zip')">
						{{ t('fileManager.contextMenu.compressZip') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="compressWithPreset('zip', true)">
						{{ t('fileManager.contextMenu.compressEncryptedZip') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="compressWithPreset('tar.gz')">
						{{ t('fileManager.contextMenu.compressTarGz') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="compressWithPreset('tar.bz2')">
						{{ t('fileManager.contextMenu.compressTarBz2') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						v-if="!context.entry.metadata.isDirectory && isArchive(context.entry)"
						@click="contextAction('decompress')"
					>
						{{ t('fileManager.contextMenu.decompress') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						@click="
							emit('sendFiles', contextEntries());
							context = null;
						"
					>
						{{ t('fileManager.contextMenu.sendTo') }}
					</UiContextMenuItem>

					<div class="mx-1 my-1 border-t border-border/50" role="separator"></div>

					<UiContextMenuItem class="justify-between gap-4" @click="begin('mkdir')">
						<span>{{ t('fileManager.actions.newFolder') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.newFolder }}</span>
					</UiContextMenuItem>
					<UiContextMenuItem @click="begin('file')">{{ t('fileManager.actions.newFile') }}</UiContextMenuItem>
					<UiContextMenuItem
						@click="
							emit('upload', browser.path.value);
							context = null;
						"
					>
						{{ t('fileManager.actions.upload') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="begin('chmod', context.entry)">
						{{ t('fileManager.actions.changePermissions') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						class="justify-between gap-4"
						@click="
							refresh();
							context = null;
						"
					>
						<span>{{ t('fileManager.actions.refresh') }}</span
						><span class="text-xs text-text-secondary">{{ shortcutHints.refresh }}</span>
					</UiContextMenuItem>
				</template>

				<template v-else>
					<UiContextMenuItem @click="contextAction('open')">
						{{ t('common.open') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						v-if="canOpenAsText(context.entry)"
						@click="
							emit('openAsText', context.entry);
							context = null;
						"
					>
						{{ t('fileManager.actions.openAsText') }}
					</UiContextMenuItem>
					<UiContextMenuItem v-if="download" @click="download(contextEntries())">
						{{ contextDownloadLabel }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="copyPath(context.entry)">
						{{ t('fileManager.actions.copyPath') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						v-if="props.clipboardCount"
						@click="
							emit('paste', browser.path.value);
							context = null;
						"
					>
						{{ t('fileManager.actions.paste') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="contextAction('copy')">
						{{ t('fileManager.actions.copy') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="contextAction('move')">
						{{ t('fileManager.actions.cut') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						@click="
							emit('sendFiles', contextEntries());
							context = null;
						"
					>
						{{ t('fileManager.actions.sendFiles') }}
					</UiContextMenuItem>
					<UiContextMenuItem
						class="justify-between"
						aria-haspopup="menu"
						:aria-expanded="Boolean(compressSubmenu)"
						@mouseenter="openCompressSubmenu"
						@focus="openCompressSubmenu"
					>
						<span>{{ t('fileManager.contextMenu.compress') }}</span
						><span aria-hidden="true">›</span>
					</UiContextMenuItem>
					<UiContextMenuItem
						v-if="!context.entry.metadata.isDirectory && isArchive(context.entry)"
						@click="contextAction('decompress')"
					>
						{{ t('fileManager.contextMenu.decompress') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="begin('rename', context.entry)">
						{{ t('fileManager.actions.rename') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="begin('chmod', context.entry)">
						{{ t('fileManager.actions.changePermissions') }}
					</UiContextMenuItem>
					<UiContextMenuItem tone="danger" @click="remove(contextEntries())">
						{{ t('fileManager.actions.delete') }}
					</UiContextMenuItem>
				</template>
			</template>
			<template v-else>
				<UiContextMenuItem
					v-if="props.clipboardCount"
					@click="
						emit('paste', context.destination);
						context = null;
					"
				>
					{{ t('fileManager.actions.paste') }}
				</UiContextMenuItem>
				<template v-if="context.scope === 'current-directory'">
					<UiContextMenuItem @click="begin('mkdir')">
						{{ t('fileManager.actions.newFolder') }}
					</UiContextMenuItem>
					<UiContextMenuItem @click="begin('file')">{{ t('fileManager.actions.newFile') }}</UiContextMenuItem>
					<UiContextMenuItem
						@click="
							emit('upload', browser.path.value);
							context = null;
						"
					>
						{{ t('fileManager.actions.upload') }}
					</UiContextMenuItem>
				</template>
				<UiContextMenuItem
					@click="
						refresh();
						context = null;
					"
				>
					{{ t('fileManager.actions.refresh') }}
				</UiContextMenuItem>
			</template>
		</UiContextMenu>

		<UiContextMenu
			v-if="compressSubmenu"
			:visible="true"
			:x="compressSubmenu.x"
			:y="compressSubmenu.y"
			:width="220"
			:z-index="140"
			:blocking-layer="false"
			@close="compressSubmenu = null"
		>
			<div :data-side="compressSubmenu.side" class="w-full">
				<UiContextMenuItem @click="compressWithPreset('zip')">
					{{ t('fileManager.contextMenu.compressZip') }}
				</UiContextMenuItem>
				<UiContextMenuItem @click="compressWithPreset('zip', true)">
					{{ t('fileManager.contextMenu.compressEncryptedZip') }}
				</UiContextMenuItem>
				<UiContextMenuItem @click="compressWithPreset('tar.gz')">
					{{ t('fileManager.contextMenu.compressTarGz') }}
				</UiContextMenuItem>
				<UiContextMenuItem @click="compressWithPreset('tar.bz2')">
					{{ t('fileManager.contextMenu.compressTarBz2') }}
				</UiContextMenuItem>
			</div>
		</UiContextMenu>

		<UiDialog
			:open="Boolean(action)"
			:title="actionTitle"
			:icon="actionIcon"
			:close-label="t('fileManager.modals.buttons.close')"
			density="comfortable"
			panel-class="!w-[calc(100vw-1.5rem)] !max-w-[28rem]"
			:data-action-type="action || ''"
			@open-change="handleActionDialogOpenChange"
		>
			<form id="file-manager-action-form" class="file-manager-dialog-form" @submit.prevent="submit">
				<UiFormField :label="actionLabel" for-id="fileManagerActionValue" density="comfortable">
					<UiInput
						id="fileManagerActionValue"
						ref="actionInput"
						v-model="value"
						autocomplete="off"
						spellcheck="false"
						density="comfortable"
						:invalid="
							createNameConflict ||
							(action === 'chmod' && Boolean(value.trim()) && !/^[0-7]{3,4}$/.test(value.trim()))
						"
						:placeholder="actionPlaceholder"
					/>
				</UiFormField>
				<UiInlineNotice v-if="createNameConflict" tone="danger" compact>
					{{ t('fileManager.errors.entryExists', { name: value.trim() }) }}
				</UiInlineNotice>
				<UiInlineNotice
					v-else-if="action === 'chmod' && value.trim() && !/^[0-7]{3,4}$/.test(value.trim())"
					tone="danger"
					compact
				>
					{{ t('fileManager.errors.invalidPermissionsFormat') }}
				</UiInlineNotice>
				<UiInlineNotice v-else-if="action === 'chmod'" tone="info" compact>
					{{ t('fileManager.modals.chmodHelp') }}
				</UiInlineNotice>
			</form>
			<template #footer>
				<UiFormActions class="file-manager-dialog-actions">
					<UiButton type="button" appearance="ghost" density="comfortable" @click="action = null">
						{{ t('fileManager.modals.buttons.cancel') }}
					</UiButton>
					<UiButton
						type="submit"
						form="file-manager-action-form"
						appearance="solid"
						tone="primary"
						density="comfortable"
						:loading="actionBusy"
						:disabled="actionConfirmDisabled"
					>
						{{ actionConfirmLabel }}
					</UiButton>
				</UiFormActions>
			</template>
		</UiDialog>
		<FilesystemCatalogModal
			:visible="catalogVisible"
			:current-path="browser.path.value"
			:trigger-element="favoriteButton"
			@close="catalogVisible = false"
			@navigate="navigate"
			@terminal="sendPathToTerminal"
		/>
	</section>
</template>

<style scoped src="./FileManager.css"></style>
