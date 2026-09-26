import { computed, ref, toRaw } from 'vue';
import type {
  WorkspaceLayoutNodeDto,
  WorkspaceLayoutSettingsRequestDto,
  WorkspacePaneNameDto,
  WorkspaceSidebarConfigDto,
} from '@nexus-terminal/protocol/settings';
import { httpClient } from '@/client/http';
import { logger } from '@/client/logging/logger';
import { createLatestValueSaver } from '@/foundation/async';

export type { WorkspacePaneNameDto, WorkspaceSidebarConfigDto } from '@nexus-terminal/protocol/settings';

export interface WorkspaceLayoutNodeState extends Omit<WorkspaceLayoutNodeDto, 'id' | 'children'> {
  id: string;
  children?: WorkspaceLayoutNodeState[];
}

export const WORKSPACE_LAYOUT_MIN_SIZE = 5;
const WORKSPACE_LAYOUT_MAX_CHILDREN = Math.floor(100 / WORKSPACE_LAYOUT_MIN_SIZE);

const paneNames = new Set<WorkspacePaneNameDto>([
  'connections',
  'terminal',
  'commandBar',
  'fileManager',
  'editor',
  'statusMonitor',
  'commandHistory',
  'quickCommands',
  'dockerManager',
  'suspendedSshSessions',
]);

export const createDefaultWorkspaceLayout = (): WorkspaceLayoutNodeState => ({
  id: 'workspace-root',
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
  const currentFlexibleTotal = safeSizes.reduce((sum, size) => sum + Math.max(size - WORKSPACE_LAYOUT_MIN_SIZE, 0), 0);
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
      typeof requestedSize === 'number' && Number.isFinite(requestedSize) ? requestedSize : currentSizes[changedIndex]!,
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

export const appendWorkspaceLayoutChild = (
  children: readonly WorkspaceLayoutNodeState[],
  child: WorkspaceLayoutNodeState,
  preferredSize = 25,
): WorkspaceLayoutNodeState[] => {
  if (children.length >= WORKSPACE_LAYOUT_MAX_CHILDREN) return [...children];
  const nextSize = children.length
    ? Math.min(Math.max(preferredSize, WORKSPACE_LAYOUT_MIN_SIZE), 100 - WORKSPACE_LAYOUT_MIN_SIZE * children.length)
    : 100;
  const existingSizes = normalizeSizes(
    children.map((existingChild) => existingChild.size),
    100 - nextSize,
  );
  return [
    ...children.map((existingChild, index) =>
      sameSize(existingChild.size, existingSizes[index]!)
        ? existingChild
        : { ...existingChild, size: existingSizes[index] },
    ),
    { ...child, size: nextSize },
  ];
};

export const normalizeWorkspaceLayout = (node: WorkspaceLayoutNodeState): WorkspaceLayoutNodeState => {
  if (node.type !== 'container') return node;
  const children = (node.children ?? []).map(normalizeWorkspaceLayout);
  const nextChildren = rebalanceWorkspaceLayoutChildren(children);
  if (children.length === nextChildren.length && children.every((child, index) => child === nextChildren[index]))
    return node;
  return { ...node, children: nextChildren };
};

const cloneWorkspaceLayout = (node: WorkspaceLayoutNodeState): WorkspaceLayoutNodeState => {
  const rawNode = toRaw(node);
  if (rawNode.type !== 'container') return { ...rawNode };
  return { ...rawNode, children: (rawNode.children ?? []).map(cloneWorkspaceLayout) };
};

const stableWorkspaceLayoutNodeId = (path: string, usedIds: Set<string>): string => {
  const baseId = `workspace-layout-${path.replaceAll('.', '-')}`;
  let nextId = baseId;
  let suffix = 2;
  while (usedIds.has(nextId)) nextId = `${baseId}-${suffix++}`;
  usedIds.add(nextId);
  return nextId;
};

const LAYOUT_STORAGE_KEY = 'nexus_terminal_layout_config';
const SIDEBAR_STORAGE_KEY = 'nexus_terminal_sidebar_config';
const defaultSidebars = (): WorkspaceSidebarConfigDto => ({ left: ['connections', 'dockerManager'], right: [] });

const validateLayout = (value: unknown, allowMissingIds = false): value is WorkspaceLayoutNodeState => {
  const nodeIds = new Set<string>();
  const components = new Set<WorkspacePaneNameDto>();
  const visit = (candidate: unknown, depth = 0): candidate is WorkspaceLayoutNodeState => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 12) return false;
    const node = candidate as Partial<WorkspaceLayoutNodeState>;
    const missingId = node.id === undefined || node.id === '';
    if (missingId) {
      if (!allowMissingIds) return false;
    } else {
      if (typeof node.id !== 'string' || nodeIds.has(node.id)) return false;
      nodeIds.add(node.id);
    }
    if (node.type === 'pane') {
      if (typeof node.component !== 'string' || !paneNames.has(node.component as WorkspacePaneNameDto)) return false;
      if (components.has(node.component as WorkspacePaneNameDto)) return false;
      components.add(node.component as WorkspacePaneNameDto);
      return true;
    }
    if (node.type !== 'container' || (node.direction !== 'horizontal' && node.direction !== 'vertical')) return false;
    return Array.isArray(node.children) && node.children.every((child) => visit(child, depth + 1));
  };
  return visit(value);
};

const assignStableWorkspaceLayoutNodeIds = (node: WorkspaceLayoutNodeState): WorkspaceLayoutNodeState => {
  const explicitIds = new Set<string>();
  const collectExplicitIds = (candidate: WorkspaceLayoutNodeState): void => {
    if (typeof candidate.id === 'string' && candidate.id) explicitIds.add(candidate.id);
    if (candidate.type === 'container') {
      for (const child of candidate.children ?? []) collectExplicitIds(child);
    }
  };
  collectExplicitIds(node);

  const usedIds = new Set(explicitIds);
  const visit = (candidate: WorkspaceLayoutNodeState, path: string): WorkspaceLayoutNodeState => {
    const id =
      typeof candidate.id === 'string' && candidate.id ? candidate.id : stableWorkspaceLayoutNodeId(path, usedIds);
    if (candidate.type !== 'container') return { ...candidate, id };
    return {
      ...candidate,
      id,
      children: (candidate.children ?? []).map((child, index) => visit(child, `${path}.${index}`)),
    };
  };
  return visit(node, 'root');
};

const normalizeWorkspaceLayoutCandidate = (value: unknown): WorkspaceLayoutNodeState | null => {
  if (!validateLayout(value, true)) return null;
  const withIds = assignStableWorkspaceLayoutNodeIds(value);
  return validateLayout(withIds) ? normalizeWorkspaceLayout(withIds) : null;
};

const layoutPaneNames = (layout: WorkspaceLayoutNodeState): Set<WorkspacePaneNameDto> => {
  const result = new Set<WorkspacePaneNameDto>();
  const visit = (node: WorkspaceLayoutNodeState): void => {
    if (node.type === 'pane' && node.component) result.add(node.component);
    else for (const child of node.children ?? []) visit(child);
  };
  visit(layout);
  return result;
};

const validSidebar = (value: unknown, layout: WorkspaceLayoutNodeState): value is WorkspaceSidebarConfigDto => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const config = value as Partial<WorkspaceSidebarConfigDto>;
  if (!Array.isArray(config.left) || !Array.isArray(config.right)) return false;
  const all = [...config.left, ...config.right];
  if (!all.every((name) => paneNames.has(name))) return false;
  if (new Set(config.left).size !== config.left.length || new Set(config.right).size !== config.right.length)
    return false;
  const mainPanes = layoutPaneNames(layout);
  return (
    all.length === new Set(all).size &&
    Number(mainPanes.has('terminal')) + all.filter((name) => name === 'terminal').length <= 1
  );
};

const defaultSidebarsFor = (layout: WorkspaceLayoutNodeState): WorkspaceSidebarConfigDto => {
  const mainPanes = layoutPaneNames(layout);
  const defaults = defaultSidebars();
  return {
    left: defaults.left.filter((pane) => pane !== 'terminal' || !mainPanes.has('terminal')),
    right: defaults.right.filter((pane) => pane !== 'terminal' || !mainPanes.has('terminal')),
  };
};

const readStored = <T>(key: string, validate: (value: unknown) => value is T): T | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Workspace layout remains usable in memory when browser storage is unavailable.
  }
};

export const createWorkspaceLayoutController = () => {
  const tree = ref<WorkspaceLayoutNodeState>(createDefaultWorkspaceLayout());
  const sidebars = ref<WorkspaceSidebarConfigDto>(defaultSidebars());
  const loaded = ref(false);
  const loading = ref(false);

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
      if (children.length === nextChildren.length && children.every((child, index) => child === nextChildren[index]))
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

  const resizeSaver = createLatestValueSaver<WorkspaceLayoutNodeState>({
    delayMs: 1000,
    async save(nextTree) {
      const request: WorkspaceLayoutNodeDto = nextTree;
      await httpClient.put('/settings/layout', request);
      writeStored(LAYOUT_STORAGE_KEY, nextTree);
    },
    onError: (error) => logger.error({ err: error }, 'Failed to persist resized workspace layout'),
  });

  const workspaceLayout = {
    tree,
    sidebars,
    loaded: computed(() => loaded.value),
    loading: computed(() => loading.value),
    paneNames: [...paneNames] as readonly WorkspacePaneNameDto[],
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      loading.value = true;
      try {
        const [layoutResult, sidebarResult] = await Promise.allSettled([
          httpClient.get<WorkspaceLayoutNodeDto | null>('/settings/layout'),
          httpClient.get<WorkspaceSidebarConfigDto>('/settings/sidebar'),
        ]);

        const backendLayout =
          layoutResult.status === 'fulfilled' ? normalizeWorkspaceLayoutCandidate(layoutResult.value.data) : null;
        const storedLayoutData = backendLayout
          ? null
          : readStored<WorkspaceLayoutNodeState>(LAYOUT_STORAGE_KEY, (value) => validateLayout(value, true));
        const storedLayout = storedLayoutData ? normalizeWorkspaceLayoutCandidate(storedLayoutData) : null;
        const nextTree = normalizeWorkspaceLayout(backendLayout ?? storedLayout ?? createDefaultWorkspaceLayout());

        const backendSidebar =
          sidebarResult.status === 'fulfilled' && validSidebar(sidebarResult.value.data, nextTree)
            ? sidebarResult.value.data
            : null;
        const storedSidebar = backendSidebar
          ? null
          : readStored<WorkspaceSidebarConfigDto>(SIDEBAR_STORAGE_KEY, (value): value is WorkspaceSidebarConfigDto =>
              validSidebar(value, nextTree),
            );
        const nextSidebars = backendSidebar ?? storedSidebar ?? defaultSidebarsFor(nextTree);

        tree.value = nextTree;
        sidebars.value = nextSidebars;
        loaded.value = true;
        if (backendLayout || storedLayout) writeStored(LAYOUT_STORAGE_KEY, nextTree);
        if (backendSidebar) writeStored(SIDEBAR_STORAGE_KEY, backendSidebar);
      } finally {
        loading.value = false;
      }
    },
    async save(nextTree: WorkspaceLayoutNodeState, nextSidebars = sidebars.value): Promise<void> {
      const candidate = normalizeWorkspaceLayoutCandidate(nextTree);
      const normalizedTree = candidate ? cloneWorkspaceLayout(candidate) : null;
      if (!normalizedTree || !validSidebar(nextSidebars, normalizedTree)) throw new Error('Invalid Workspace layout.');
      await resizeSaver.flush();
      const request: WorkspaceLayoutSettingsRequestDto = { layout: normalizedTree, sidebar: nextSidebars };
      await httpClient.put('/settings/workspace-layout', request);
      tree.value = normalizedTree;
      sidebars.value = nextSidebars;
      loaded.value = true;
      writeStored(LAYOUT_STORAGE_KEY, normalizedTree);
      writeStored(SIDEBAR_STORAGE_KEY, nextSidebars);
    },
    updateNodeSizes(containerId: string, sizes: readonly number[]): void {
      const nextTree = updateContainerSizes(tree.value, containerId, sizes);
      if (nextTree === tree.value) return;
      tree.value = nextTree;
      loaded.value = true;
      resizeSaver.schedule(cloneWorkspaceLayout(nextTree));
    },
    async reset(): Promise<void> {
      const next = createDefaultWorkspaceLayout();
      await this.save(next, defaultSidebarsFor(next));
    },
  };

  return { ...workspaceLayout, dispose: () => resizeSaver.dispose({ flush: true }) };
};

export type WorkspaceLayoutController = ReturnType<typeof createWorkspaceLayoutController>;
