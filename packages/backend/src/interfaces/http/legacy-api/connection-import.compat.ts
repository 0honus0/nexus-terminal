import type { ConnectionService } from '../../../modules/connections/connection.service';
import type { ProxyService } from '../../../modules/proxies/proxy.service';
import { fromLegacyConnectionCreateDto, type LegacyConnectionWriteDto } from './connection-http.mapper';
import { fromLegacyProxyCreateDto, type LegacyProxyWriteDto } from './proxy-http.mapper';

interface LegacyImportedConnection extends LegacyConnectionWriteDto {
  proxy?: LegacyProxyWriteDto | null;
}
export interface LegacyConnectionImportResult {
  successCount: number;
  failureCount: number;
  errors: Array<{ connectionName?: string; message: string }>;
}

/** Temporary compatibility workflow for the obsolete JSON connection import endpoint. */
export const importLegacyConnections = async (
  bytes: Uint8Array,
  dependencies: { connections: ConnectionService; proxies: ProxyService },
): Promise<LegacyConnectionImportResult> => {
  let values: LegacyImportedConnection[];
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error('JSON 文件内容必须是一个数组。');
    values = parsed;
  } catch (error) {
    throw new Error(`解析 JSON 文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  let successCount = 0;
  const errors: Array<{ connectionName?: string; message: string }> = [];
  for (const source of values) {
    try {
      let proxyId = source.proxy_id === undefined ? null : Number(source.proxy_id);
      if (source.proxy) {
        const wanted = source.proxy;
        const existing = (await dependencies.proxies.list()).find(
          (proxy) =>
            proxy.name === wanted.name &&
            proxy.type === wanted.type &&
            proxy.host === wanted.host &&
            proxy.port === Number(wanted.port),
        );
        proxyId = existing?.id ?? (await dependencies.proxies.create(fromLegacyProxyCreateDto(wanted))).id;
      }
      const dto: LegacyConnectionWriteDto = {
        ...source,
        ...(proxyId ? { proxy_id: proxyId, proxy_type: source.proxy_type ?? 'proxy' } : {}),
      };
      await dependencies.connections.create(fromLegacyConnectionCreateDto(dto));
      successCount += 1;
    } catch (error) {
      errors.push({
        connectionName: source.name ?? undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { successCount, failureCount: errors.length, errors };
};
