import type { RemoteDesktopProxyRequest } from '../remote-desktop-proxy.transport';

/**
 * Current frontend compatibility: the historical backend ignored the query-string DPI and derived it from width.
 * Delete this rule with the legacy WebSocket API when the frontend owns an explicit DPI contract.
 */
export const mapLegacyRemoteDesktopProxyRequest = (url: URL): RemoteDesktopProxyRequest | null => {
  const token = url.searchParams.get('token');
  const width = Number(url.searchParams.get('width'));
  const height = Number(url.searchParams.get('height'));
  if (!token || !Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null;
  return {
    token,
    width,
    height,
    dpi: width > 1920 ? 120 : 96,
  };
};
