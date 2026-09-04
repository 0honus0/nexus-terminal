import { computed, ref } from 'vue';
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
      size: 15,
      children: [
        { id: 'workspace-status', type: 'pane', component: 'statusMonitor', size: 44 },
        { id: 'workspace-history', type: 'pane', component: 'commandHistory', size: 27 },
        { id: 'workspace-quick', type: 'pane', component: 'quickCommands', size: 29 },
      ],
    },
    {
      id: 'workspace-center',
      type: 'container',
      direction: 'vertical',
      size: 58,
      children: [
        { id: 'workspace-terminal', type: 'pane', component: 'terminal', size: 60 },
        { id: 'workspace-command', type: 'pane', component: 'commandBar', size: 7 },
        { id: 'workspace-files', type: 'pane', component: 'fileManager', size: 33 },
      ],
    },
    {
      id: 'workspace-right',
      type: 'container',
      direction: 'vertical',
      size: 27,
      children: [{ id: 'workspace-editor', type: 'pane', component: 'editor', size: 100 }],
    },
  ],
});

const LAYOUT_STORAGE_KEY = 'nexus_terminal_layout_config';
const SIDEBAR_STORAGE_KEY = 'nexus_terminal_sidebar_config';
const defaultSidebars = (): WorkspaceSidebarConfig => ({ left: ['connections', 'dockerManager'], right: [] });

const validateLayout = (value: unknown): value is WorkspaceLayoutNode => {
  const nodeIds = new Set<string>();
  let terminalCount = 0;
  const visit = (candidate: unknown, depth = 0): candidate is WorkspaceLayoutNode => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 12) return false;
    const node = candidate as Partial<WorkspaceLayoutNode>;
    if (typeof node.id !== 'string' || !node.id || nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
    if (node.type === 'pane') {
      if (typeof node.component !== 'string' || !paneNames.has(node.component as WorkspacePaneName)) return false;
      if (node.component === 'terminal' && ++terminalCount > 1) return false;
      return true;
    }
    if (node.type !== 'container' || (node.direction !== 'horizontal' && node.direction !== 'vertical')) return false;
    return Array.isArray(node.children) && node.children.every((child) => visit(child, depth + 1));
  };
  return visit(value);
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
  return Number(mainPanes.has('terminal')) + all.filter((name) => name === 'terminal').length <= 1;
};

const defaultSidebarsFor = (layout: WorkspaceLayoutNode): WorkspaceSidebarConfig => {
  const terminalUsed = layoutPaneNames(layout).has('terminal');
  const defaults = defaultSidebars();
  return {
    left: defaults.left.filter((pane) => pane !== 'terminal' || !terminalUsed),
    right: defaults.right.filter((pane) => pane !== 'terminal' || !terminalUsed),
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
    let changed = false;
    const nextChildren = children.map((child, index) => {
      const size = sizes[index];
      if (typeof size !== 'number' || !Number.isFinite(size) || Math.abs((child.size ?? 0) - size) < 0.01) return child;
      changed = true;
      return { ...child, size };
    });
    return changed ? { ...node, children: nextChildren } : node;
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
        layoutResult.status === 'fulfilled' && validateLayout(layoutResult.value.data) ? layoutResult.value.data : null;
      const storedLayout = backendLayout ? null : readStored<WorkspaceLayoutNode>(LAYOUT_STORAGE_KEY, validateLayout);
      const nextTree = backendLayout ?? storedLayout ?? createDefaultWorkspaceLayout();

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
      if (backendLayout) writeStored(LAYOUT_STORAGE_KEY, backendLayout);
      if (backendSidebar) writeStored(SIDEBAR_STORAGE_KEY, backendSidebar);
    } finally {
      loading.value = false;
    }
  },
  async save(nextTree: WorkspaceLayoutNode, nextSidebars = sidebars.value): Promise<void> {
    if (!validateLayout(nextTree) || !validSidebar(nextSidebars, nextTree))
      throw new Error('Invalid Workspace layout.');
    await resizeSaver.flush();
    await Promise.all([
      httpClient.put('/settings/layout', nextTree),
      httpClient.put('/settings/sidebar', nextSidebars),
    ]);
    tree.value = nextTree;
    sidebars.value = nextSidebars;
    loaded.value = true;
    writeStored(LAYOUT_STORAGE_KEY, nextTree);
    writeStored(SIDEBAR_STORAGE_KEY, nextSidebars);
  },
  updateNodeSizes(containerId: string, sizes: readonly number[]): void {
    const nextTree = updateContainerSizes(tree.value, containerId, sizes);
    if (nextTree === tree.value) return;
    tree.value = nextTree;
    loaded.value = true;
    resizeSaver.schedule(structuredClone(nextTree));
  },
  async reset(): Promise<void> {
    const next = createDefaultWorkspaceLayout();
    await this.save(next, defaultSidebarsFor(next));
  },
};
