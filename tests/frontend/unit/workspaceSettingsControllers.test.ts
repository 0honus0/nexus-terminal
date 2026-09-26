import type {
  WorkspaceFocusConfigDto,
  WorkspaceLayoutNodeDto,
  WorkspaceLayoutSettingsRequestDto,
  WorkspaceSidebarConfigDto,
} from '../../../packages/protocol/src/settings';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceFocusController } from '../../../packages/frontend/src/runtimes/workspace/focus/workspaceFocus';
import {
  createDefaultWorkspaceLayout,
  createWorkspaceLayoutController,
} from '../../../packages/frontend/src/runtimes/workspace/layout/workspaceLayout';
import type { WorkspaceSettingsRepository } from '../../../packages/frontend/src/runtimes/workspace/ports/workspace-settings-repository';

const createRepository = (overrides: Partial<WorkspaceSettingsRepository> = {}): WorkspaceSettingsRepository => ({
  loadLayout: vi.fn<() => Promise<WorkspaceLayoutNodeDto | null>>().mockResolvedValue(null),
  loadSidebar: vi
    .fn<() => Promise<WorkspaceSidebarConfigDto>>()
    .mockResolvedValue({ left: ['connections', 'dockerManager'], right: [] }),
  saveResizedLayout: vi.fn<(layout: WorkspaceLayoutNodeDto) => Promise<void>>().mockResolvedValue(undefined),
  saveLayout: vi.fn<(settings: WorkspaceLayoutSettingsRequestDto) => Promise<void>>().mockResolvedValue(undefined),
  loadFocus: vi
    .fn<() => Promise<WorkspaceFocusConfigDto>>()
    .mockResolvedValue({ sequence: ['terminalSearch', 'commandInput'], shortcuts: {} }),
  saveFocus: vi.fn<(config: WorkspaceFocusConfigDto) => Promise<void>>().mockResolvedValue(undefined),
  ...overrides,
});

describe('workspace settings controllers', () => {
  it('loads layout and sidebar state through the injected repository', async () => {
    const repository = createRepository();
    const controller = createWorkspaceLayoutController(repository);

    await controller.load();

    expect(repository.loadLayout).toHaveBeenCalledOnce();
    expect(repository.loadSidebar).toHaveBeenCalledOnce();
    expect(controller.loaded.value).toBe(true);
    expect(controller.sidebars.value).toEqual({ left: ['connections', 'dockerManager'], right: [] });
  });

  it('persists validated layout state through the injected repository', async () => {
    const repository = createRepository();
    const controller = createWorkspaceLayoutController(repository);
    const layout = createDefaultWorkspaceLayout();
    const sidebar: WorkspaceSidebarConfigDto = { left: ['connections'], right: ['dockerManager'] };

    await controller.save(layout, sidebar);

    expect(repository.saveLayout).toHaveBeenCalledWith({ layout, sidebar });
    expect(controller.sidebars.value).toEqual(sidebar);
  });

  it('loads and saves focus state through the injected repository', async () => {
    const repository = createRepository();
    const controller = createWorkspaceFocusController(repository);

    await controller.load();
    expect(controller.config.value.sequence).toEqual(['terminalSearch', 'commandInput']);

    const next: WorkspaceFocusConfigDto = {
      sequence: ['commandInput', 'terminalSearch'],
      shortcuts: { commandInput: { shortcut: 'Alt+C' } },
    };
    await controller.save(next);

    expect(repository.saveFocus).toHaveBeenCalledWith(next);
    expect(controller.config.value).toEqual(next);
    expect(controller.config.value).not.toBe(next);
  });
});
