import { computed, ref, toRaw } from 'vue';
import { httpClient } from '@/client/http';
import { createLatestValueSaver } from '@/foundation/async';

export type WorkspacePaneName =
  | 'connections'
  | 'terminal'
  | 'commandBar'
  | 'fileManager'
  | 'editor'
  | 'statusMonitor'
  | 'commandHistory'
  | 'quickCommands'
  | 'dockerManager'
  | 'suspendedSshSessions';

export interface WorkspaceLayoutNode {
  id: string;
  type: 'pane' | 'container';
  component?: WorkspacePaneName;
  direction?: 'horizontal' | 'vertical';
  children?: WorkspaceLayoutNode[];
  size?: number;
}

export interface WorkspaceSidebarConfig {
  left: WorkspacePaneName[];
  right: WorkspacePaneName[];
}

export const WORKSPACE_LAYOUT_MIN_SIZE = 5;
const WORKSPACE_LAYOUT_MAX_CHILDREN = Math.floor(100 / WORKSPACE_LAYOUT_MIN_SIZE);

const paneNames = new Set<WorkspacePaneName>([
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

export const createDefaultWorkspaceLayout = (): WorkspaceLayoutNode => ({
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
  children: readonly WorkspaceLayoutNode[],
  changedIndex?: number,
): WorkspaceLayoutNode[] => {
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
  children: readonly WorkspaceLayoutNode[],
  child: WorkspaceLayoutNode,
  preferredSize = 25,
): WorkspaceLayoutNode[] => {
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

export const normalizeWorkspaceLayout = (node: WorkspaceLayoutNode): WorkspaceLayoutNode => {
  if (node.type !== 'container') return node;
  const children = (node.children ?? []).map(normalizeWorkspaceLayout);
  const nextChildren = rebalanceWorkspaceLayoutChildren(children);
  if (children.length === nextChildren.length && children.every((child, index) => child === nextChildren[index]))
    return node;
  return { ...node, children: nextChildren };
};

const cloneWorkspaceLayout = (node: WorkspaceLayoutNode): WorkspaceLayoutNode => {
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
const defaultSidebars = (): WorkspaceSidebarConfig => ({ left: ['connections', 'dockerManager'], right: [] });

const validateLayout = (value: unknown, allowMissingIds = false): value is WorkspaceLayoutNode => {
  const nodeIds = new Set<string>();
  const components = new Set<WorkspacePaneName>();
  const visit = (candidate: unknown, depth = 0): candidate is WorkspaceLayoutNode => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 12) return false;
    const node = candidate as Partial<WorkspaceLayoutNode>;
    const missingId = node.id === undefined || node.id === '';
    if (missingId) {
      if (!allowMissingIds) return false;
    } else {
      if (typeof node.id !== 'string' || nodeIds.has(node.id)) return false;
      nodeIds.add(node.id);
    }
    if (node.type === 'pane') {
      if (typeof node.component !== 'string' || !paneNames.has(node.component as WorkspacePaneName)) return false;
      if (components.has(node.component as WorkspacePaneName)) return false;
      components.add(node.component as WorkspacePaneName);
      return true;
    }
    if (node.type !== 'container' || (node.direction !== 'horizontal' && node.direction !== 'vertical')) return false;
    return Array.isArray(node.children) && node.children.every((child) => visit(child, depth + 1));
  };
  return visit(value);
};

const assignStableWorkspaceLayoutNodeIds = (node: WorkspaceLayoutNode): WorkspaceLayoutNode => {
  const explicitIds = new Set<string>();
  const collectExplicitIds = (candidate: WorkspaceLayoutNode): void => {
    if (typeof candidate.id === 'string' && candidate.id) explicitIds.add(candidate.id);
    if (candidate.type === 'container') {
      for (const child of candidate.children ?? []) collectExplicitIds(child);
    }
  };
  collectExplicitIds(node);

  const usedIds = new Set(explicitIds);
  const visit = (candidate: WorkspaceLayoutNode, path: string): WorkspaceLayoutNode => {
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

const normalizeWorkspaceLayoutCandidate = (value: unknown): WorkspaceLayoutNode | null => {
  if (!validateLayout(value, true)) return null;
  const withIds = assignStableWorkspaceLayoutNodeIds(value);
  return validateLayout(withIds) ? normalizeWorkspaceLayout(withIds) : null;
};

const layoutPaneNames = (layout: WorkspaceLayoutNode): Set<WorkspacePaneName> => {
  const result = new Set<WorkspacePaneName>();
  const visit = (node: WorkspaceLayoutNode): void => {
    if (node.type === 'pane' && node.component) result.add(node.component);
    else for (const child of node.children ?? []) visit(child);
  };
  visit(layout);
  return result;
};

const validSidebar = (value: unknown, layout: WorkspaceLayoutNode): value is WorkspaceSidebarConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const config = value as Partial<WorkspaceSidebarConfig>;
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

const defaultSidebarsFor = (layout: WorkspaceLayoutNode): WorkspaceSidebarConfig => {
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

const tree = ref<WorkspaceLayoutNode>(createDefaultWorkspaceLayout());
const sidebars = ref<WorkspaceSidebarConfig>(defaultSidebars());
const loaded = ref(false);
const loading = ref(false);

const updateContainerSizes = (
  node: WorkspaceLayoutNode,
  containerId: string,
  sizes: readonly number[],
): WorkspaceLayoutNode => {
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

const resizeSaver = createLatestValueSaver<WorkspaceLayoutNode>({
  delayMs: 1000,
  async save(nextTree) {
    await httpClient.put('/settings/layout', nextTree);
    writeStored(LAYOUT_STORAGE_KEY, nextTree);
  },
  onError: (error) => console.error('[WorkspaceLayout] Failed to persist resized layout.', error),
});

export const workspaceLayout = {
  tree,
  sidebars,
  loaded: computed(() => loaded.value),
  loading: computed(() => loading.value),
  paneNames: [...paneNames] as readonly WorkspacePaneName[],
  async load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      const [layoutResult, sidebarResult] = await Promise.allSettled([
        httpClient.get<unknown>('/settings/layout'),
        httpClient.get<unknown>('/settings/sidebar'),
      ]);

      const backendLayout =
        layoutResult.status === 'fulfilled' ? normalizeWorkspaceLayoutCandidate(layoutResult.value.data) : null;
      const storedLayoutData = backendLayout
        ? null
        : readStored<WorkspaceLayoutNode>(LAYOUT_STORAGE_KEY, (value) => validateLayout(value, true));
      const storedLayout = storedLayoutData ? normalizeWorkspaceLayoutCandidate(storedLayoutData) : null;
      const nextTree = normalizeWorkspaceLayout(backendLayout ?? storedLayout ?? createDefaultWorkspaceLayout());

      const backendSidebar =
        sidebarResult.status === 'fulfilled' && validSidebar(sidebarResult.value.data, nextTree)
          ? sidebarResult.value.data
          : null;
      const storedSidebar = backendSidebar
        ? null
        : readStored<WorkspaceSidebarConfig>(SIDEBAR_STORAGE_KEY, (value): value is WorkspaceSidebarConfig =>
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
  async save(nextTree: WorkspaceLayoutNode, nextSidebars = sidebars.value): Promise<void> {
    const candidate = normalizeWorkspaceLayoutCandidate(nextTree);
    const normalizedTree = candidate ? cloneWorkspaceLayout(candidate) : null;
    if (!normalizedTree || !validSidebar(nextSidebars, normalizedTree)) throw new Error('Invalid Workspace layout.');
    await resizeSaver.flush();
    await Promise.all([
      httpClient.put('/settings/layout', normalizedTree),
      httpClient.put('/settings/sidebar', nextSidebars),
    ]);
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
