import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import * as path from 'path';

const MAX_LOG_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const LOG_DIRECTORY = path.resolve('./data/temp_suspended_ssh_logs/');
const SAFE_LOG_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * TemporaryLogStorageService负责管理临时日志文件的原子化读、写、删除及轮替操作。
 */
export class TemporaryLogStorageService {
  private readonly writers = new Map<string, {
    tail: Promise<void>;
    size?: number;
    revision: number;
    error?: unknown;
  }>();

  constructor() {
    void this.ensureLogDirectoryExists();
  }

  /**
   * 确保日志目录存在，如果不存在则创建它。
   */
  async ensureLogDirectoryExists(): Promise<void> {
    try {
      await fs.mkdir(LOG_DIRECTORY, { recursive: true, mode: 0o700 });
      // console.log(`日志目录 '${LOG_DIRECTORY}' 已确保存在。`);
    } catch (error) {
      console.error(`创建日志目录 '${LOG_DIRECTORY}' 失败:`, error);
      // 在实际应用中，这里可能需要更健壮的错误处理
    }
  }

  private getLogFilePath(suspendSessionId: string): string {
    if (!SAFE_LOG_IDENTIFIER.test(suspendSessionId)) {
      throw new Error('Invalid suspended SSH log identifier.');
    }
    return path.join(LOG_DIRECTORY, `${suspendSessionId}.log`);
  }

  private getWriter(suspendSessionId: string): {
    tail: Promise<void>;
    size?: number;
    revision: number;
    error?: unknown;
  } {
    let writer = this.writers.get(suspendSessionId);
    if (!writer) {
      writer = { tail: Promise.resolve(), revision: 0 };
      this.writers.set(suspendSessionId, writer);
    }
    return writer;
  }

  private enqueue(suspendSessionId: string, operation: (writer: { size?: number }) => Promise<void>): Promise<void> {
    const writer = this.getWriter(suspendSessionId);
    writer.revision += 1;
    const result = writer.tail.then(() => operation(writer)).catch(error => {
      writer.error = error;
      throw error;
    });
    writer.tail = result.catch(() => undefined);
    return result;
  }

  /**
   * 将数据写入指定挂起会话的日志文件。
   * 如果文件大小超过MAX_LOG_SIZE_BYTES，将采取轮替策略（清空并从头开始写）。
   * @param suspendSessionId - 挂起会话的ID。
   * @param data - 要写入的原始终端字节或文本。
   */
  async writeToLog(suspendSessionId: string, data: string | Uint8Array): Promise<void> {
    const filePath = this.getLogFilePath(suspendSessionId);
    const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    if (chunk.length === 0) return;
    return this.enqueue(suspendSessionId, async writer => {
      try {
        await this.ensureLogDirectoryExists();
        if (writer.size === undefined) {
          try {
            writer.size = (await fs.stat(filePath)).size;
          } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
            writer.size = 0;
          }
        }

        const retainedChunk = chunk.length > MAX_LOG_SIZE_BYTES
          ? chunk.subarray(chunk.length - MAX_LOG_SIZE_BYTES)
          : chunk;
        if (writer.size + retainedChunk.length > MAX_LOG_SIZE_BYTES) {
          console.log(`日志文件 '${filePath}' 达到 ${MAX_LOG_SIZE_BYTES / (1024 * 1024)}MB，执行轮替。`);
          await fs.writeFile(filePath, retainedChunk, { mode: 0o600 });
          writer.size = retainedChunk.length;
        } else {
          await fs.appendFile(filePath, retainedChunk, { mode: 0o600 });
          writer.size += retainedChunk.length;
        }
      } catch (error) {
        console.error(`写入日志文件 '${filePath}' 失败:`, error);
        throw error;
      }
    });
  }

  async flush(suspendSessionId: string): Promise<void> {
    const writer = this.getWriter(suspendSessionId);
    await writer.tail;
    if (writer.error !== undefined) {
      const error = writer.error;
      writer.error = undefined;
      throw error;
    }
  }

  async createLogReadStream(suspendSessionId: string): Promise<Readable> {
    const filePath = this.getLogFilePath(suspendSessionId);
    await this.flush(suspendSessionId);
    try {
      await fs.access(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') return Readable.from([]);
      throw error;
    }
    return createReadStream(filePath, { highWaterMark: 64 * 1024 });
  }

  /**
   * 删除指定挂起会话的日志文件。
   * @param suspendSessionId - 挂起会话的ID。
   */
  async deleteLog(suspendSessionId: string): Promise<void> {
    const filePath = this.getLogFilePath(suspendSessionId);
    const writer = this.getWriter(suspendSessionId);
    const deletion = this.enqueue(suspendSessionId, async currentWriter => {
      try {
        await fs.unlink(filePath);
        currentWriter.size = 0;
      } catch (error: any) {
        if (error.code === 'ENOENT') return;
        console.error(`删除日志文件 '${filePath}' 失败:`, error);
        throw error;
      }
    });
    const deletionRevision = writer.revision;
    await deletion;
    if (this.writers.get(suspendSessionId) === writer && writer.revision === deletionRevision) {
      this.writers.delete(suspendSessionId);
    }
  }

  /**
   * 列出日志目录中的所有日志文件名（不含扩展名，即suspendSessionId）。
   * 这可以用于 `SshSuspendService` 初始化时加载已断开的会话。
   * @returns 返回包含所有 suspendSessionId 的数组。
   */
  async listLogFiles(): Promise<string[]> {
    try {
      await this.ensureLogDirectoryExists();
      const files = await fs.readdir(LOG_DIRECTORY);
      return files
        .filter(file => file.endsWith('.log') && SAFE_LOG_IDENTIFIER.test(file.replace(/\.log$/, '')))
        .map(file => file.replace(/\.log$/, ''));
    } catch (error) {
      console.error(`列出日志目录 '${LOG_DIRECTORY}' 中的文件失败:`, error);
      return []; // 发生错误时返回空数组
    }
  }
}

// 单例模式导出
export const temporaryLogStorageService = new TemporaryLogStorageService();
