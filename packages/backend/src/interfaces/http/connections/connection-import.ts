import type {
  ConnectionImportResult,
  ConnectionImportService,
} from '../../../modules/connections/connection-import.service';

/** Parses the JSON upload at the HTTP boundary; compatibility semantics live in Connections. */
export const importConnections = async (
  bytes: Uint8Array,
  service: ConnectionImportService,
): Promise<ConnectionImportResult> => {
  let values: unknown[];
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JSON 文件内容必须是一个数组。');
    values = parsed;
  } catch (error) {
    throw new Error(`解析 JSON 文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return service.importRecords(values);
};
