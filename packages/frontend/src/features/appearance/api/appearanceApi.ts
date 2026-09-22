import type {
  AppearanceBackgroundUploadResponseDto,
  AppearanceSettingsDto,
  AppearanceUpdateRequestDto,
  HtmlThemeCreateRequestDto,
  HtmlThemeUpdateRequestDto,
  LocalHtmlThemeDto,
  RemoteHtmlRepositoryResponseDto,
  RemoteHtmlRepositoryUpdateRequestDto,
  RemoteHtmlThemeDto,
  TerminalThemeCreateRequestDto,
  TerminalThemeDto,
  TerminalThemeUpdateRequestDto,
} from '@nexus-terminal/protocol/appearance';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';
import type { AppearanceSettings, LocalHtmlTheme, RemoteHtmlTheme, TerminalTheme } from '../model/appearance';

const triggerBlobDownload = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const appearanceApi = {
  async load(): Promise<AppearanceSettings> {
    return (await httpClient.get<AppearanceSettingsDto>('/appearance')).data;
  },

  async update(patch: Partial<AppearanceSettings>): Promise<AppearanceSettings> {
    const request: AppearanceUpdateRequestDto = patch;
    return (await httpClient.put<AppearanceSettingsDto>('/appearance', request)).data;
  },

  async listThemes(): Promise<TerminalTheme[]> {
    return (await httpClient.get<TerminalThemeDto[]>('/terminal-themes')).data;
  },

  async createTheme(name: string, themeData: Record<string, string>): Promise<void> {
    const request: TerminalThemeCreateRequestDto = { name, themeData };
    await httpClient.post<TerminalThemeDto>('/terminal-themes', request);
  },

  async updateTheme(id: number, name: string, themeData: Record<string, string>): Promise<void> {
    const request: TerminalThemeUpdateRequestDto = { name, themeData };
    await httpClient.put<MessageResponseDto>(`/terminal-themes/${id}`, request);
  },

  async deleteTheme(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/terminal-themes/${id}`);
  },

  async importTheme(file: File, name?: string): Promise<void> {
    const form = new FormData();
    form.append('themeFile', file);
    if (name?.trim()) form.append('name', name.trim());
    await httpClient.post<TerminalThemeDto>('/terminal-themes/import', form);
  },

  async exportTheme(id: number, fileName: string): Promise<void> {
    const response = await httpClient.get<Blob>(`/terminal-themes/${id}/export`, { responseType: 'blob' });
    triggerBlobDownload(response.data, fileName);
  },

  async uploadBackground(kind: 'page' | 'terminal', file: File): Promise<string> {
    const form = new FormData();
    form.append(kind === 'page' ? 'pageBackgroundFile' : 'terminalBackgroundFile', file);
    const response = await httpClient.post<AppearanceBackgroundUploadResponseDto>(
      `/appearance/background/${kind}`,
      form,
    );
    return response.data.filePath;
  },

  async removeBackground(kind: 'page' | 'terminal'): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/appearance/background/${kind}`);
  },

  async listLocalHtmlThemes(): Promise<LocalHtmlTheme[]> {
    return (await httpClient.get<LocalHtmlThemeDto[]>('/appearance/html-presets/local')).data;
  },

  async readLocalHtmlTheme(name: string): Promise<string> {
    return (
      await httpClient.get<string>(`/appearance/html-presets/local/${encodeURIComponent(name)}`, {
        responseType: 'text',
      })
    ).data;
  },

  async createLocalHtmlTheme(name: string, content: string): Promise<void> {
    const request: HtmlThemeCreateRequestDto = { name, content };
    await httpClient.post<MessageResponseDto>('/appearance/html-presets/local', request);
  },

  async updateLocalHtmlTheme(name: string, content: string): Promise<void> {
    const request: HtmlThemeUpdateRequestDto = { content };
    await httpClient.put<MessageResponseDto>(`/appearance/html-presets/local/${encodeURIComponent(name)}`, request);
  },

  async deleteLocalHtmlTheme(name: string): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/appearance/html-presets/local/${encodeURIComponent(name)}`);
  },

  async getRemoteHtmlRepositoryUrl(): Promise<string | null> {
    return (
      await httpClient.get<RemoteHtmlRepositoryResponseDto>('/appearance/html-presets/remote/repository-url')
    ).data.url;
  },

  async setRemoteHtmlRepositoryUrl(url: string | null): Promise<void> {
    const request: RemoteHtmlRepositoryUpdateRequestDto = { url };
    await httpClient.put<MessageResponseDto>('/appearance/html-presets/remote/repository-url', request);
  },

  async listRemoteHtmlThemes(repoUrl?: string): Promise<RemoteHtmlTheme[]> {
    return (
      await httpClient.get<RemoteHtmlThemeDto[]>('/appearance/html-presets/remote/list', {
        params: repoUrl ? { repoUrl } : undefined,
      })
    ).data;
  },

  async readRemoteHtmlTheme(fileUrl: string): Promise<string> {
    return (
      await httpClient.get<string>('/appearance/html-presets/remote/content', {
        params: { fileUrl },
        responseType: 'text',
      })
    ).data;
  },
};
