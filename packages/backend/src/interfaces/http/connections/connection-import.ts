import type { CreateConnectionInput } from '../../../modules/connections/connection.types';
import type { ConnectionService } from '../../../modules/connections/connection.service';
import type { ProxyInput } from '../../../modules/proxies/proxy.types';
import type { ProxyService } from '../../../modules/proxies/proxy.service';

interface ImportedConnectionRecord extends CreateConnectionInput {
  proxy?: ProxyInput | null;
}

export interface ConnectionImportResult {
  successCount: number;
  failureCount: number;
  errors: Array<{ connectionName?: string; message: string }>;
}

/** Parses the clean JSON connection-import format at the HTTP boundary. */
export const importConnections = async (
  bytes: Uint8Array,
  dependencies: { connections: ConnectionService; proxies: ProxyService },
): Promise<ConnectionImportResult> => {
  let values: ImportedConnectionRecord[];
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JSON 文件内容必须是一个数组。');
    values = parsed as ImportedConnectionRecord[];
  } catch (error) {
    throw new Error(`解析 JSON 文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  let successCount = 0;
  const errors: ConnectionImportResult['errors'] = [];
  for (const source of values) {
    try {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('连接记录必须是 JSON 对象。');
      const { proxy, ...connection } = source;
      let proxyId = connection.proxyId ?? null;
      if (proxy) {
        const existing = (await dependencies.proxies.list()).find(
          (candidate) =>
            candidate.name === proxy.name &&
            candidate.type === proxy.type &&
            candidate.host === proxy.host &&
            candidate.port === proxy.port,
        );
        proxyId = existing?.id ?? (await dependencies.proxies.create(proxy)).id;
      }
      await dependencies.connections.create({
        ...connection,
        proxyId,
        ...(proxyId && connection.route === undefined ? { route: 'proxy' as const } : {}),
      });
      successCount += 1;
    } catch (error) {
      errors.push({
        connectionName: typeof source?.name === 'string' ? source.name : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { successCount, failureCount: errors.length, errors };
};
