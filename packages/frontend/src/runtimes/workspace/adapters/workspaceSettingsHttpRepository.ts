import type {
  WorkspaceFocusConfigDto,
  WorkspaceLayoutNodeDto,
  WorkspaceLayoutSettingsRequestDto,
  WorkspaceSidebarConfigDto,
} from '@nexus-terminal/protocol/settings';
import { httpClient } from '@/client/http';
import type { WorkspaceSettingsRepository } from '../ports/workspace-settings-repository';

export const workspaceSettingsHttpRepository: WorkspaceSettingsRepository = {
  async loadLayout() {
    return (await httpClient.get<WorkspaceLayoutNodeDto | null>('/settings/layout')).data;
  },
  async loadSidebar() {
    return (await httpClient.get<WorkspaceSidebarConfigDto>('/settings/sidebar')).data;
  },
  async saveResizedLayout(layout) {
    await httpClient.put('/settings/layout', layout);
  },
  async saveLayout(settings: WorkspaceLayoutSettingsRequestDto) {
    await httpClient.put('/settings/workspace-layout', settings);
  },
  async loadFocus() {
    return (await httpClient.get<WorkspaceFocusConfigDto>('/settings/focus-switcher-sequence')).data;
  },
  async saveFocus(config) {
    await httpClient.put('/settings/focus-switcher-sequence', config);
  },
};
