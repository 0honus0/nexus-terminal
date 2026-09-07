import { httpClient } from '@/client/http';

const contentDispositionFileName = (header: unknown, fallback: string): string => {
  if (typeof header !== 'string' || !header.trim()) return fallback;

  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1]?.trim();
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, '')) || fallback;
    } catch {
      // Fall back to the plain filename parameter or the stable local name.
    }
  }

  const plain = header.match(/filename=(?:"([^"]+)"|([^;]+))/i);
  return plain?.[1]?.trim() || plain?.[2]?.trim() || fallback;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const backupApi = {
  async exportFull(password: string): Promise<void> {
    const response = await httpClient.post<Blob>('/settings/backup/export', { password }, { responseType: 'blob' });
    const fallback = `nexus-terminal-backup-${new Date().toISOString().replaceAll(':', '-')}.nexus-backup`;
    downloadBlob(response.data, contentDispositionFileName(response.headers['content-disposition'], fallback));
  },
  async importFull(file: File, password?: string): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append('backupFile', file);
    if (password) form.append('password', password);
    const response = await httpClient.post<Record<string, unknown>>('/settings/backup/import', form);
    return response.data;
  },
  async exportConnections(): Promise<void> {
    const response = await httpClient.get<Blob>('/settings/export-connections', { responseType: 'blob' });
    downloadBlob(
      response.data,
      contentDispositionFileName(response.headers['content-disposition'], 'nexus_connections_export.zip'),
    );
  },
};
