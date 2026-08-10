import type { Component } from 'vue';
import type { FileListItem } from '../../types/sftp.types';

export interface FilePreviewContext {
  /** 当前文件的完整远程路径。 */
  filePath: string;

  /** 当预览关闭或切换到其他文件时会被取消。 */
  signal: AbortSignal;

  /**
   * 构造同源、带认证会话的流式预览地址。
   * 浏览器关闭预览时会自动取消未完成的 HTTP 请求。
   */
  buildInlineUrl(path: string): string;

  /**
   * 通过当前 SFTP 会话读取远程文件，并自动绑定预览生命周期。
   * Provider 可按需调用 response.text()/blob()/arrayBuffer()。
   */
  fetchInline(path?: string): Promise<Response>;
}

export interface FilePreviewData {
  /** 仅传给动态预览组件的 props。 */
  componentProps: Record<string, unknown>;

  /** Provider 创建了临时资源时，在预览关闭后释放。 */
  dispose?: () => void;
}

export interface FilePreviewProvider {
  /** 注册表中的稳定唯一标识。 */
  id: string;

  /** 数值越大越优先匹配。 */
  priority?: number;

  /** 单文件允许内联预览的最大字节数。 */
  maxInlineSize?: number;

  canPreview(file: FileListItem): boolean;
  preview(file: FileListItem): Component;
  load(file: FileListItem, context: FilePreviewContext): Promise<FilePreviewData> | FilePreviewData;
}
