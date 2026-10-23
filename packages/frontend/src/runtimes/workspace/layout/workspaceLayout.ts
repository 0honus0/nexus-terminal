import { computed, ref } from 'vue';
import { WORKSPACE_PANES, type WorkspacePane } from '@nexus-terminal/shared/preferences/presentation/values';
import { logger } from '@/client/logging/logger';
import { createLatestValueSaver } from '@/foundation/async';
import type { WorkspaceSettingsRepository } from '../ports/workspace-settings-repository';
import type { WorkspaceLayoutNodeState, WorkspaceSidebar } from '../model/presentation-types';

export const WORKSPACE_LAYOUT_MIN_SIZE = 5;

const paneNames = new Set<WorkspacePane>(WORKSPACE_PANES);

const WORKSPACE_PANE_MINIMUMS: Record<WorkspacePane, { inline: number; block: number }> = {
	connections: { inline: 12, block: 14 },
	terminal: { inline: 20, block: 24 },
	commandBar: { inline: 10, block: 5 },
	fileManager: { inline: 13, block: 14 },
	editor: { inline: 14, block: 16 },
	statusMonitor: { inline: 12, block: 38 },
	commandHistory: { inline: 12, block: 12 },
	quickCommands: { inline: 12, block: 38 },
	dockerManager: { inline: 12, block: 14 },
	suspendedSshSessions: { inline: 12, block: 12 },
};

const WORKSPACE_PANE_MINIMUM_INLINE_PIXELS: Partial<Record<WorkspacePane, number>> = {
	commandBar: 100,
	fileManager: 170,
	suspendedSshSessions: 170,
};

const WORKSPACE_PANE_MINIMUM_BLOCK_PIXELS: Partial<Record<WorkspacePane, number>> = {
	commandBar: 38,
};

const WORKSPACE_PANE_MAXIMUM_BLOCK_PIXELS: Partial<Record<WorkspacePane, number>> = {
	commandBar: 42,
};

const layoutNodeMinimumSize = (
	node: WorkspaceLayoutNodeState,
	axis: 'horizontal' | 'vertical',
	inlineSize: number,
	blockSize: number,
): number => {
	if (node.type === 'pane' && node.component) {
		const fixedInlineMinimum = WORKSPACE_PANE_MINIMUM_INLINE_PIXELS[node.component];
		if (axis === 'horizontal' && fixedInlineMinimum && inlineSize > 0) {
			return (fixedInlineMinimum / inlineSize) * 100;
		}
		const fixedBlockMinimum = WORKSPACE_PANE_MINIMUM_BLOCK_PIXELS[node.component];
		if (axis === 'vertical' && fixedBlockMinimum && blockSize > 0) {
			return (fixedBlockMinimum / blockSize) * 100;
		}
		const minimum = WORKSPACE_PANE_MINIMUMS[node.component];
		return axis === 'horizontal' ? minimum.inline : minimum.block;
	}
	const children = node.children ?? [];
	if (!children.length) return WORKSPACE_LAYOUT_MIN_SIZE;
	const minimums = children.map((child) => layoutNodeMinimumSize(child, axis, inlineSize, blockSize));
	return node.direction === axis ? minimums.reduce((total, minimum) => total + minimum, 0) : Math.max(...minimums);
};

export const workspacePaneMinimumSize = (
	node: WorkspaceLayoutNodeState,
	direction: 'horizontal' | 'vertical',
	siblingCount: number,
	inlineSize = 0,
	blockSize = 0,
): number => {
	const requested = layoutNodeMinimumSize(node, direction, inlineSize, blockSize);
	const safeMaximum = 90 / Math.max(1, siblingCount);
	return Math.max(1, Math.min(requested, safeMaximum));
};

export const workspacePaneMaximumSize = (
	node: WorkspaceLayoutNodeState,
	direction: 'horizontal' | 'vertical',
	blockSize = 0,
): number => {
	if (node.type !== 'pane' || !node.component || direction !== 'vertical' || blockSize <= 0) return 100;
	const fixedBlockMaximum = WORKSPACE_PANE_MAXIMUM_BLOCK_PIXELS[node.component];
	if (!fixedBlockMaximum) return 100;
	return Math.max(1, Math.min(100, (fixedBlockMaximum / blockSize) * 100));
};

export const createDefaultWorkspaceLayout = (): WorkspaceLayoutNodeState => ({
	id: 'workspace-root',
	size: 100,
	type: 'container',
	direction: 'horizontal',
	children: [
		{
			id: 'workspace-left',
			type: 'container',
			direction: 'vertical',
			size: 14.59006012147659,
			children: [
				{ id: 'workspace-status', type: 'pane', component: 'statusMonitor', size: 44.56372126372345 },
				{ id: 'workspace-history', type: 'pane', component: 'commandHistory', size: 26.235651482670775 },
				{ id: 'workspace-quick', type: 'pane', component: 'quickCommands', size: 29.200627253605774 },
			],
		},
		{
			id: 'workspace-center',
			type: 'container',
			direction: 'vertical',
			size: 58.02787988626151,
			children: [
				{ id: 'workspace-terminal', type: 'pane', component: 'terminal', size: 59.94833664833884 },
				{ id: 'workspace-command', type: 'pane', component: 'commandBar', size: 5 },
				{ id: 'workspace-files', type: 'pane', component: 'fileManager', size: 35.05166335166116 },
			],
		},
		{
			id: 'workspace-right',
			type: 'container',
			direction: 'vertical',
			size: 27.3820599922619,
			children: [{ id: 'workspace-editor', type: 'pane', component: 'editor', size: 100 }],
		},
	],
});

const normalizeSizes = (sizes: readonly (number | undefined)[], total = 100): number[] => {
	if (!sizes.length) return [];
	const minimumTotal = WORKSPACE_LAYOUT_MIN_SIZE * sizes.length;
	if (minimumTotal >= total) return sizes.map(() => total / sizes.length);

	const safeSizes = sizes.map((size) =>
		typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : WORKSPACE_LAYOUT_MIN_SIZE,
	);
	const flexibleTotal = total - minimumTotal;
	const currentFlexibleTotal = safeSizes.reduce(
		(sum, size) => sum + Math.max(size - WORKSPACE_LAYOUT_MIN_SIZE, 0),
		0,
	);
	if (currentFlexibleTotal <= 0) return sizes.map(() => total / sizes.length);
	return safeSizes.map(
		(size) =>
			WORKSPACE_LAYOUT_MIN_SIZE +
			(Math.max(size - WORKSPACE_LAYOUT_MIN_SIZE, 0) * flexibleTotal) / currentFlexibleTotal,
	);
};

const sameSize = (left: number | undefined, right: number): boolean =>
	typeof left === 'number' && Math.abs(left - right) < 0.0001;

export const rebalanceWorkspaceLayoutChildren = (
	children: readonly WorkspaceLayoutNodeState[],
	changedIndex?: number,
): WorkspaceLayoutNodeState[] => {
	if (!children.length) return [];
	const currentSizes = normalizeSizes(children.map((child) => child.size));
	if (changedIndex === undefined || changedIndex < 0 || changedIndex >= children.length) {
		return children.map((child, index) =>
			sameSize(child.size, currentSizes[index]!) ? child : { ...child, size: currentSizes[index] },
		);
	}

	const maxChangedSize = 100 - WORKSPACE_LAYOUT_MIN_SIZE * (children.length - 1);
	const requestedSize = children[changedIndex]?.size;
	const changedSize = Math.min(
		Math.max(
			typeof requestedSize === 'number' && Number.isFinite(requestedSize)
				? requestedSize
				: currentSizes[changedIndex]!,
			WORKSPACE_LAYOUT_MIN_SIZE,
		),
		maxChangedSize,
	);
	const otherSizes = normalizeSizes(
		currentSizes.filter((_, index) => index !== changedIndex),
		100 - changedSize,
	);
	let otherIndex = 0;
	return children.map((child, index) => {
		const size = index === changedIndex ? changedSize : otherSizes[otherIndex++];
		return sameSize(child.size, size!) ? child : { ...child, size };
	});
};

export const normalizeWorkspaceLayout = (node: WorkspaceLayoutNodeState): WorkspaceLayoutNodeState => {
	if (node.type !== 'container') return node;
	const children = (node.children ?? []).map(normalizeWorkspaceLayout);
	const nextChildren = rebalanceWorkspaceLayoutChildren(children);
	if (children.length === nextChildren.length && children.every((child, index) => child === nextChildren[index]))
		return node;
	return { ...node, children: nextChildren };
};

export const cloneWorkspaceLayout = (node: WorkspaceLayoutNodeState): WorkspaceLayoutNodeState => ({
	id: node.id,
	type: node.type,
	size: node.size,
	component: node.component,
	direction: node.direction,
	children: node.children?.map(cloneWorkspaceLayout),
});

const defaultSidebars = (): WorkspaceSidebar => ({ left: ['connections', 'dockerManager'], right: [] });

export const createWorkspaceLayoutController = (
	settingsRepository: WorkspaceSettingsRepository,
	capturePermission: () => AbortSignal,
) => {
	const tree = ref<WorkspaceLayoutNodeState>(createDefaultWorkspaceLayout());
	const sidebars = ref<WorkspaceSidebar>(defaultSidebars());
	const loaded = ref(false);
	const loading = ref(false);
	const version = ref(0);
	const error = ref<unknown>(null);
	const scope = new AbortController();
	let revision = 0;

	const updateContainerSizes = (
		node: WorkspaceLayoutNodeState,
		containerId: string,
		sizes: readonly number[],
	): WorkspaceLayoutNodeState => {
		if (node.id === containerId && node.type === 'container') {
			const children = node.children ?? [];
			if (children.length !== sizes.length) return node;
			const resizedChildren = children.map((child, index) => {
				const size = sizes[index];
				return typeof size === 'number' && Number.isFinite(size) ? { ...child, size } : child;
			});
			const nextChildren = rebalanceWorkspaceLayoutChildren(resizedChildren);
			if (
				children.length === nextChildren.length &&
				children.every((child, index) => child === nextChildren[index])
			)
				return node;
			return { ...node, children: nextChildren };
		}
		if (node.type !== 'container' || !node.children?.length) return node;
		let changed = false;
		const children = node.children.map((child) => {
			const next = updateContainerSizes(child, containerId, sizes);
			if (next !== child) changed = true;
			return next;
		});
		return changed ? { ...node, children } : node;
	};

	const resizeSaver = createLatestValueSaver<{ layout: WorkspaceLayoutNodeState; permission: AbortSignal }>({
		delayMs: 1000,

		async save({ layout, permission }) {
			if (permission.aborted) return;
			const result = await settingsRepository.saveResizedLayout(
				layout,
				AbortSignal.any([permission, scope.signal]),
			);
			if (!scope.signal.aborted && !permission.aborted) {
				version.value = result;
				error.value = null;
			}
		},

		onError: (cause) => {
			if (!scope.signal.aborted) {
				error.value = cause;
				logger.error({ err: cause }, 'Failed to persist resized workspace layout');
			}
		},
	});

	const workspaceLayout = {
		tree,
		sidebars,

		resetState(): void {
			revision++;
			loaded.value = false;
			loading.value = false;
			version.value = 0;
			tree.value = createDefaultWorkspaceLayout();
			sidebars.value = defaultSidebars();
			error.value = null;
		},

		version: computed(() => version.value),
		error: computed(() => error.value),
		loaded: computed(() => loaded.value),
		loading: computed(() => loading.value),
		paneNames: [...paneNames] as readonly WorkspacePane[],

		async load(force = false): Promise<void> {
			if (scope.signal.aborted || (loaded.value && !force)) return;
			const permission = capturePermission();
			const originalRevision = ++revision;
			loading.value = true;
			try {
				const value = await settingsRepository.loadLayout(force);
				if (scope.signal.aborted || permission.aborted || originalRevision !== revision) return;
				tree.value = cloneWorkspaceLayout(value.layout);
				sidebars.value = {
					left: value.sidebar.left.map((pane) => pane),
					right: value.sidebar.right.map((pane) => pane),
				};
				version.value = value.version;
				loaded.value = true;
				error.value = null;
			} catch (cause) {
				if (!scope.signal.aborted && !permission.aborted && originalRevision === revision) error.value = cause;
				throw cause;
			} finally {
				if (!scope.signal.aborted && originalRevision === revision) loading.value = false;
			}
		},

		async save(
			nextTree: WorkspaceLayoutNodeState,
			nextSidebars = sidebars.value,
			expectedVersion = version.value,
			permission = capturePermission(),
		): Promise<void> {
			const layout = cloneWorkspaceLayout(normalizeWorkspaceLayout(nextTree));
			const sidebar = {
				left: nextSidebars.left.map((pane) => pane),
				right: nextSidebars.right.map((pane) => pane),
			};
			await resizeSaver.flush();
			const result = await settingsRepository.saveLayout(
				{ version: expectedVersion, layout, sidebar },
				AbortSignal.any([permission, scope.signal]),
			);
			if (scope.signal.aborted || permission.aborted) return;
			revision++;
			tree.value = layout;
			sidebars.value = sidebar;
			version.value = result;
			loaded.value = true;
			error.value = null;
		},

		updateNodeSizes(containerId: string, sizes: readonly number[]): void {
			if (!loaded.value || scope.signal.aborted || error.value) return;
			const nextTree = updateContainerSizes(tree.value, containerId, sizes);
			if (nextTree === tree.value) return;
			tree.value = nextTree;
			loaded.value = true;
			resizeSaver.schedule({
				permission: capturePermission(),
				layout: cloneWorkspaceLayout(nextTree),
			});
		},

		async reset(): Promise<void> {
			const next = createDefaultWorkspaceLayout();
			await this.save(next, defaultSidebars());
		},
	};

	return {
		...workspaceLayout,

		dispose: () => {
			scope.abort();
			revision++;
			return resizeSaver.dispose();
		},
	};
};

export type WorkspaceLayoutController = ReturnType<typeof createWorkspaceLayoutController>;
