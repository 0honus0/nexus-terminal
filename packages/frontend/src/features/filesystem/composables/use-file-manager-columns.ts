import {
	computed,
	onActivated,
	onBeforeUnmount,
	onDeactivated,
	ref,
	watch,
	type ComputedRef,
	type CSSProperties,
	type Ref,
} from 'vue';

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

interface FileManagerColumnsOptions {
	viewportWidth: Readonly<Ref<number>>;
	isMobile: Readonly<Ref<boolean>>;
	widths: () => Record<string, number> | undefined;
	available: () => boolean;
	onCommit: (widths: Record<string, number>) => void;
}

interface FileManagerColumnsController {
	showPermissions: ComputedRef<boolean>;
	showModified: ComputedRef<boolean>;
	isLarge: ComputedRef<boolean>;
	isMedium: ComputedRef<boolean>;
	isSmall: ComputedRef<boolean>;
	visibleColumnCount: ComputedRef<number>;
	canResizeName: ComputedRef<boolean>;
	canResizePermissions: ComputedRef<boolean>;
	isCustomResized: Ref<boolean>;
	totalColumnWidth: ComputedRef<number>;
	columnStyle(key: ColumnKey): CSSProperties;
	startColumnResize(event: PointerEvent, key: ColumnKey): void;
	cancelColumnResize(): void;
}

export function useFileManagerColumns(options: FileManagerColumnsOptions): FileManagerColumnsController {
	const isCustomResized = ref(false);
	let active = true;
	let activeColumnResize:
		| {
				key: ColumnKey;
				pointerId: number;
				startX: number;
				startWidth: number;
				cursor: string;
				userSelect: string;
		  }
		| undefined;

	const initialColumnWidth = (key: ColumnKey): number => {
		const width = options.widths()?.[key];
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
	const showPermissions = computed(() => options.viewportWidth.value >= 560);
	const showModified = computed(() => options.viewportWidth.value >= 400);
	const isLarge = computed(() => showPermissions.value);
	const isMedium = computed(() => !showPermissions.value && showModified.value);
	const isSmall = computed(() => !showModified.value);
	const visibleColumnCount = computed(() => 1 + (showPermissions.value ? 1 : 0) + (showModified.value ? 1 : 0));
	const canResizeName = computed(() => !options.isMobile.value && (showPermissions.value || showModified.value));
	const canResizePermissions = computed(() => !options.isMobile.value && showModified.value);

	const totalColumnWidth = computed(() => {
		let sum = renderedColumnWidths.value.name;
		if (showPermissions.value) sum += renderedColumnWidths.value.permissions;
		if (showModified.value) sum += renderedColumnWidths.value.modified;
		return sum;
	});

	const cancelColumnResize = (): void => {
		const current = activeColumnResize;
		if (!current) return;
		activeColumnResize = undefined;
		window.removeEventListener('pointermove', moveColumnResize);
		window.removeEventListener('pointerup', stopColumnResize);
		window.removeEventListener('pointercancel', cancelPointerResize);
		window.removeEventListener('blur', cancelColumnResize);
		document.removeEventListener('visibilitychange', cancelHiddenResize);
		document.body.style.cursor = current.cursor;
		document.body.style.userSelect = current.userSelect;
	};

	function cancelPointerResize(event: PointerEvent): void {
		if (activeColumnResize?.pointerId === event.pointerId) cancelColumnResize();
	}

	function cancelHiddenResize(): void {
		if (document.hidden) cancelColumnResize();
	}

	function stopColumnResize(event: PointerEvent): void {
		if (!activeColumnResize || event.pointerId !== activeColumnResize.pointerId) return;
		const canCommit = active && options.available();
		cancelColumnResize();
		if (canCommit) options.onCommit({ ...renderedColumnWidths.value });
	}

	function moveColumnResize(event: PointerEvent): void {
		const current = activeColumnResize;
		if (!current || event.pointerId !== current.pointerId) return;
		if (!active || !options.available()) {
			cancelColumnResize();
			return;
		}
		isCustomResized.value = true;
		const minimum = minimumColumnWidths[current.key];
		const next = Math.max(minimum, Math.min(900, current.startWidth + event.clientX - current.startX));
		renderedColumnWidths.value = { ...renderedColumnWidths.value, [current.key]: Math.round(next) };
	}

	const startColumnResize = (event: PointerEvent, key: ColumnKey): void => {
		if (!active || !options.available() || !event.isPrimary || activeColumnResize) return;
		event.preventDefault();
		event.stopPropagation();
		activeColumnResize = {
			key,
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: renderedColumnWidths.value[key],
			cursor: document.body.style.cursor,
			userSelect: document.body.style.userSelect,
		};
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', moveColumnResize);
		window.addEventListener('pointerup', stopColumnResize);
		window.addEventListener('pointercancel', cancelPointerResize);
		window.addEventListener('blur', cancelColumnResize);
		document.addEventListener('visibilitychange', cancelHiddenResize);
	};

	const columnStyle = (key: ColumnKey): CSSProperties => {
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
				const w = options.viewportWidth.value < 460 ? 90 : 98;
				return { width: `${w}px`, minWidth: `${minimumColumnWidths.permissions}px` };
			}
			if (key === 'modified') {
				const w = options.viewportWidth.value < 360 ? 108 : 136;
				return { width: `${w}px`, minWidth: `${minimumColumnWidths.modified}px` };
			}
		}
		return {
			width: `${renderedColumnWidths.value[key]}px`,
			minWidth: `${minimumColumnWidths[key]}px`,
		};
	};

	watch(
		options.widths,
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

	onActivated(() => {
		active = true;
	});
	onDeactivated(() => {
		active = false;
		cancelColumnResize();
	});
	onBeforeUnmount(() => {
		active = false;
		cancelColumnResize();
	});

	return {
		showPermissions,
		showModified,
		isLarge,
		isMedium,
		isSmall,
		visibleColumnCount,
		canResizeName,
		canResizePermissions,
		isCustomResized,
		totalColumnWidth,
		columnStyle,
		startColumnResize,
		cancelColumnResize,
	};
}
