import type { Readable } from 'node:stream';
import type { GitHubThemeRepositoryRef, RemoteHtmlThemeSummary } from './appearance.types';

export interface BackgroundAsset {
  publicPath: string;
  fileName: string;
}

export interface BackgroundAssetContent {
  stream: Readable;
  contentType: string;
  size: number;
}

export interface BackgroundAssetStore {
  save(content: Uint8Array, mimeType: string): Promise<BackgroundAsset>;
  read(fileName: string): Promise<BackgroundAssetContent | null>;
  existsPublicPath(publicPath: string): Promise<boolean>;
  removePublicPath(publicPath: string): Promise<boolean>;
}

export interface HtmlThemeStore {
  listPreset(): Promise<string[]>;
  listCustom(): Promise<string[]>;
  readPreset(name: string): Promise<string | null>;
  readCustom(name: string): Promise<string | null>;
  createCustom(name: string, content: string): Promise<void>;
  updateCustom(name: string, content: string): Promise<boolean>;
  deleteCustom(name: string): Promise<boolean>;
}

export interface RemoteHtmlThemeCatalog {
  list(repository: GitHubThemeRepositoryRef): Promise<RemoteHtmlThemeSummary[]>;
  readRawHtml(url: string): Promise<string>;
}
