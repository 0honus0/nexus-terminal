import type {
  WorkspaceFocusConfigDto,
  WorkspaceLayoutNodeDto,
  WorkspaceLayoutSettingsRequestDto,
  WorkspaceSidebarConfigDto,
} from '@nexus-terminal/protocol/settings';

export interface WorkspaceSettingsRepository {
  loadLayout(): Promise<WorkspaceLayoutNodeDto | null>;
  loadSidebar(): Promise<WorkspaceSidebarConfigDto>;
  saveResizedLayout(layout: WorkspaceLayoutNodeDto): Promise<void>;
  saveLayout(settings: WorkspaceLayoutSettingsRequestDto): Promise<void>;
  loadFocus(): Promise<WorkspaceFocusConfigDto>;
  saveFocus(config: WorkspaceFocusConfigDto): Promise<void>;
}
