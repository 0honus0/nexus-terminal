import axios from 'axios';
import type { RemoteHtmlThemeCatalog } from '../../modules/appearance/appearance-assets.port';
import type { GitHubThemeRepositoryRef, RemoteHtmlThemeSummary } from '../../modules/appearance/appearance.types';

const MAX_REMOTE_THEME_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

interface GitHubContentItem {
  type?: string;
  name?: string;
  download_url?: string | null;
}

export class GitHubHtmlThemeCatalogAdapter implements RemoteHtmlThemeCatalog {
  async list(repository: GitHubThemeRepositoryRef): Promise<RemoteHtmlThemeSummary[]> {
    const encodedPath = repository.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const suffix = encodedPath ? `/contents/${encodedPath}` : '/contents';
    const url = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}${suffix}`;
    const response = await axios.get<GitHubContentItem[]>(url, {
      params: { ref: repository.ref },
      headers: { Accept: 'application/vnd.github.v3+json' },
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_REMOTE_THEME_BYTES,
    });
    if (!Array.isArray(response.data)) throw new Error('远程仓库路径不是目录。');
    return response.data
      .filter((item) => item.type === 'file' && typeof item.name === 'string' && item.name.endsWith('.html'))
      .map((item) => ({ name: item.name!, downloadUrl: item.download_url ?? null }));
  }

  async readRawHtml(url: string): Promise<string> {
    const response = await axios.get<string>(url, {
      responseType: 'text',
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_REMOTE_THEME_BYTES,
    });
    if (typeof response.data !== 'string') throw new Error('远程 HTML 主题内容格式无效。');
    return response.data;
  }
}
