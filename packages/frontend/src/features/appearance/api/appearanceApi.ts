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
    return (await httpClient.get<AppearanceSettings>('/appearance')).data;
  },

  async update(patch: Partial<AppearanceSettings>): Promise<AppearanceSettings> {
    return (await httpClient.put<AppearanceSettings>('/appearance', patch)).data;
  },

  async listThemes(): Promise<TerminalTheme[]> {
    return (await httpClient.get<TerminalTheme[]>('/terminal-themes')).data;
  },

  async createTheme(name: string, themeData: Record<string, string>): Promise<void> {
    await httpClient.post('/terminal-themes', { name, themeData });
  },

  async updateTheme(id: number, name: string, themeData: Record<string, string>): Promise<void> {
    await httpClient.put(`/terminal-themes/${id}`, { name, themeData });
  },

  async deleteTheme(id: number): Promise<void> {
    await httpClient.delete(`/terminal-themes/${id}`);
  },

  async importTheme(file: File, name?: string): Promise<void> {
    const form = new FormData();
    form.append('themeFile', file);
    if (name?.trim()) form.append('name', name.trim());
    await httpClient.post('/terminal-themes/import', form);
  },

  async exportTheme(id: number, fileName: string): Promise<void> {
    const response = await httpClient.get<Blob>(`/terminal-themes/${id}/export`, { responseType: 'blob' });
    triggerBlobDownload(response.data, fileName);
  },

  async uploadBackground(kind: 'page' | 'terminal', file: File): Promise<void> {
    const form = new FormData();
    form.append(kind === 'page' ? 'pageBackgroundFile' : 'terminalBackgroundFile', file);
    await httpClient.post(`/appearance/background/${kind}`, form);
  },

  async removeBackground(kind: 'page' | 'terminal'): Promise<void> {
    await httpClient.delete(`/appearance/background/${kind}`);
  },

  async listLocalHtmlThemes(): Promise<LocalHtmlTheme[]> {
    return (await httpClient.get<LocalHtmlTheme[]>('/appearance/html-presets/local')).data;
  },

  async readLocalHtmlTheme(name: string): Promise<string> {
    return (
      await httpClient.get<string>(`/appearance/html-presets/local/${encodeURIComponent(name)}`, {
        responseType: 'text',
      })
    ).data;
  },

  async createLocalHtmlTheme(name: string, content: string): Promise<void> {
    await httpClient.post('/appearance/html-presets/local', { name, content });
  },

  async updateLocalHtmlTheme(name: string, content: string): Promise<void> {
    await httpClient.put(`/appearance/html-presets/local/${encodeURIComponent(name)}`, { content });
  },

  async deleteLocalHtmlTheme(name: string): Promise<void> {
    await httpClient.delete(`/appearance/html-presets/local/${encodeURIComponent(name)}`);
  },

  async getRemoteHtmlRepositoryUrl(): Promise<string | null> {
    return (await httpClient.get<{ url: string | null }>('/appearance/html-presets/remote/repository-url')).data.url;
  },

  async setRemoteHtmlRepositoryUrl(url: string | null): Promise<void> {
    await httpClient.put('/appearance/html-presets/remote/repository-url', { url });
  },

  async listRemoteHtmlThemes(repoUrl?: string): Promise<RemoteHtmlTheme[]> {
    return (
      await httpClient.get<RemoteHtmlTheme[]>('/appearance/html-presets/remote/list', {
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
