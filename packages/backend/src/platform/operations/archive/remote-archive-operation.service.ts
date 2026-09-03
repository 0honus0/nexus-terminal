import path from 'node:path';
import type { ExecutionSessionManager } from '../../execution/execution-session-manager';
import type { RemoteCommandSession } from '../../execution/remote-execution.port';
import { quotePosixShellArg } from '../../execution/posix-shell';
import type {
  ArchiveErrorCode,
  ArchiveEvent,
  ArchiveFormat,
  ArchiveOperation,
  ArchiveOperationKind,
  CompressArchiveRequest,
  DecompressArchiveRequest,
} from './archive-operation.port';

interface ActiveArchive {
  ownerId: string;
  requestId: string;
  operation: ArchiveOperationKind;
  command?: RemoteCommandSession;
  cancelled: boolean;
}

const MAX_PASSWORD_LENGTH = 128;
const TOTAL_MARKER = '__NEXUS_ARCHIVE_TOTAL__:';
const PASSWORD_REQUIRED_MARKER = '__NEXUS_ARCHIVE_PASSWORD_REQUIRED__';
const INVALID_PASSWORD_MARKER = '__NEXUS_ARCHIVE_INVALID_PASSWORD__';

export class RemoteArchiveOperationService implements ArchiveOperation {
  private readonly active = new Map<string, ActiveArchive>();

  constructor(private readonly sessions: Pick<ExecutionSessionManager, 'require'>) {}

  async compress(request: CompressArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void> {
    const key = this.key(request.ownerId, request.requestId);
    if (this.active.has(key)) throw new Error(`Archive operation ${request.requestId} already exists.`);
    const passwordError = this.validatePassword(request.password);
    if (passwordError) {
      this.emitFailed(emit, 'compress', request.requestId, passwordError.message, passwordError.code);
      return;
    }
    if (request.password !== undefined && request.format !== 'zip') {
      this.emitFailed(emit, 'compress', request.requestId, 'Password protection is only supported for ZIP archives.', 'UNSUPPORTED_FORMAT');
      return;
    }
    if (!request.sourcePaths.length) {
      this.emitFailed(emit, 'compress', request.requestId, 'At least one source path is required.');
      return;
    }

    const session = this.sessions.require(request.sessionId);
    const required = request.format === 'zip' ? 'zip' : 'tar';
    if (!(await this.commandExists(session, required))) {
      this.emitFailed(emit, 'compress', request.requestId, `${required} is not installed on the remote server.`, 'COMMAND_NOT_FOUND', required);
      return;
    }

    const destination = this.absolutePath(request.destinationPath, 'archive destination');
    const targetDirectory = path.posix.dirname(destination);
    const sourceArgs = request.sourcePaths.map(source => {
      const normalized = this.absolutePath(source, 'archive source');
      const relative = path.posix.relative(targetDirectory, normalized);
      if (relative === '..' || relative.startsWith('../')) {
        throw new Error(`Archive source must be within destination directory: ${normalized}`);
      }
      return relative || path.posix.basename(normalized);
    });
    const temporary = `${destination}.nexus-archive-${request.requestId}.part`;
    const command = this.buildCompressCommand(request.format, targetDirectory, sourceArgs, temporary, request.password);
    const active: ActiveArchive = { ownerId: request.ownerId, requestId: request.requestId, operation: 'compress', cancelled: false };
    this.active.set(key, active);
    try {
      await this.runArchiveCommand(session, active, command, emit, 'compress', request.requestId, request.format);
      if (active.cancelled) return;
      const filesystem = await session.fileSystem('control');
      await filesystem.replaceFile(temporary, destination);
      emit({ type: 'completed', operation: 'compress', requestId: request.requestId, path: destination });
    } catch (error) {
      if (active.cancelled) emit({ type: 'cancelled', operation: 'compress', requestId: request.requestId });
      else this.emitFailed(emit, 'compress', request.requestId, error instanceof Error ? error.message : String(error));
      const filesystem = await session.fileSystem('control').catch(() => null);
      await filesystem?.removeFile(temporary, { ignoreMissing: true }).catch(() => undefined);
    } finally {
      this.active.delete(key);
    }
  }

  async decompress(request: DecompressArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void> {
    const key = this.key(request.ownerId, request.requestId);
    if (this.active.has(key)) throw new Error(`Archive operation ${request.requestId} already exists.`);
    const passwordError = this.validatePassword(request.password);
    if (passwordError) {
      this.emitFailed(emit, 'decompress', request.requestId, passwordError.message, passwordError.code);
      return;
    }

    const archivePath = this.absolutePath(request.archivePath, 'archive path');
    const kind = this.detectArchiveKind(archivePath);
    if (!kind) {
      this.emitFailed(emit, 'decompress', request.requestId, 'Unsupported archive format.', 'UNSUPPORTED_FORMAT');
      return;
    }
    if (request.password !== undefined && kind !== 'zip') {
      this.emitFailed(emit, 'decompress', request.requestId, 'Passwords are only supported for ZIP archives.', 'UNSUPPORTED_FORMAT');
      return;
    }

    const session = this.sessions.require(request.sessionId);
    const required = kind === 'zip' ? 'unzip' : 'tar';
    if (!(await this.commandExists(session, required))) {
      this.emitFailed(emit, 'decompress', request.requestId, `${required} is not installed on the remote server.`, 'COMMAND_NOT_FOUND', required);
      return;
    }

    const active: ActiveArchive = { ownerId: request.ownerId, requestId: request.requestId, operation: 'decompress', cancelled: false };
    this.active.set(key, active);
    const command = this.buildDecompressCommand(archivePath, kind, request.password);
    try {
      const result = await this.runArchiveCommand(session, active, command, emit, 'decompress', request.requestId, kind);
      if (active.cancelled) return;
      const combined = `${result.stdout}\n${result.stderr}`;
      if (combined.includes(PASSWORD_REQUIRED_MARKER)) {
        this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is required.', 'PASSWORD_REQUIRED');
        return;
      }
      if (combined.includes(INVALID_PASSWORD_MARKER)) {
        this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is invalid.', 'INVALID_PASSWORD');
        return;
      }
      emit({ type: 'completed', operation: 'decompress', requestId: request.requestId, path: path.posix.dirname(archivePath) });
    } catch (error) {
      if (active.cancelled) emit({ type: 'cancelled', operation: 'decompress', requestId: request.requestId });
      else {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes(PASSWORD_REQUIRED_MARKER)) this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is required.', 'PASSWORD_REQUIRED');
        else if (message.includes(INVALID_PASSWORD_MARKER)) this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is invalid.', 'INVALID_PASSWORD');
        else this.emitFailed(emit, 'decompress', request.requestId, message);
      }
    } finally {
      this.active.delete(key);
    }
  }

  async cancel(ownerId: string, requestId: string): Promise<boolean> {
    const active = this.active.get(this.key(ownerId, requestId));
    if (!active) return false;
    active.cancelled = true;
    await active.command?.terminate({ signal: 'TERM', graceMs: 800, forceMs: 2500 });
    return true;
  }

  async cancelOwner(ownerId: string): Promise<void> {
    const ids = [...this.active.values()].filter(value => value.ownerId === ownerId).map(value => value.requestId);
    await Promise.all(ids.map(requestId => this.cancel(ownerId, requestId)));
  }

  private async runArchiveCommand(
    session: ReturnType<Pick<ExecutionSessionManager, 'require'>['require']>,
    active: ActiveArchive,
    command: string,
    emit: (event: ArchiveEvent) => void,
    operation: ArchiveOperationKind,
    requestId: string,
    format: ArchiveFormat | 'zip',
  ): Promise<{ stdout: string; stderr: string }> {
    const commandSession = await session.startCommand({ command, maxOutputBytes: 256 * 1024 });
    active.command = commandSession;
    let fileCount = 0;
    let totalFiles: number | undefined;
    let lineBuffer = '';
    const consume = (data: Uint8Array) => {
      lineBuffer += Buffer.from(data).toString('utf8');
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith(TOTAL_MARKER)) {
          const value = Number.parseInt(line.slice(TOTAL_MARKER.length).trim(), 10);
          if (Number.isFinite(value)) totalFiles = value;
          continue;
        }
        const currentFile = this.parseFileLine(line, format);
        if (!currentFile) continue;
        fileCount += 1;
        emit({
          type: 'progress', operation, requestId, fileCount,
          ...(totalFiles !== undefined ? { totalFiles, percent: totalFiles > 0 ? Math.min(100, Math.round(fileCount / totalFiles * 100)) : 100 } : {}),
          currentFile,
        });
      }
    };
    const offOut = commandSession.onStdout(consume);
    const offErr = commandSession.onStderr(consume);
    try {
      const closeEvent = await new Promise<{ exitCode: number | null }>((resolve, reject) => {
        const offClose = commandSession.onClose(event => { offClose(); offError(); resolve(event); });
        const offError = commandSession.onError(error => { offClose(); offError(); reject(error); });
      });
      const snapshot = commandSession.snapshot();
      if (active.cancelled) throw new DOMException('Archive operation cancelled.', 'AbortError');
      if (closeEvent.exitCode !== 0) throw new Error(snapshot.stderr.trim() || snapshot.stdout.trim() || `Archive command exited with ${closeEvent.exitCode}.`);
      return { stdout: snapshot.stdout, stderr: snapshot.stderr };
    } finally {
      offOut();
      offErr();
      active.command = undefined;
    }
  }

  private buildCompressCommand(format: ArchiveFormat, directory: string, sources: readonly string[], temporaryPath: string, password?: string): string {
    const cd = `cd ${quotePosixShellArg(directory)}`;
    const quotedSources = sources.map(source => quotePosixShellArg(source)).join(' ');
    const output = quotePosixShellArg(path.posix.basename(temporaryPath));
    if (format === 'zip') {
      const passwordArg = password !== undefined ? `-P ${quotePosixShellArg(password)} ` : '';
      return `${cd} && rm -f -- ${output} && zip ${passwordArg}-r ${output} ${quotedSources}`;
    }
    if (format === 'targz') return `${cd} && rm -f -- ${output} && tar -czvf ${output} ${quotedSources}`;
    return `${cd} && rm -f -- ${output} && tar -cjvf ${output} ${quotedSources}`;
  }

  private buildDecompressCommand(archivePath: string, kind: ArchiveFormat | 'zip', password?: string): string {
    const directory = path.posix.dirname(archivePath);
    const basename = path.posix.basename(archivePath);
    const safeBasename = basename.startsWith('-') ? `./${basename}` : basename;
    const archive = quotePosixShellArg(safeBasename);
    const cd = `cd ${quotePosixShellArg(directory)}`;
    if (kind === 'zip') {
      const preflight = password === undefined
        ? `if LC_ALL=C unzip -Z -v ${archive} 2>/dev/null | grep -Eqi 'file security status:[[:space:]]*encrypted'; then printf '${PASSWORD_REQUIRED_MARKER}\\n' >&2; exit 82; fi`
        : `password_test_output=$(LC_ALL=C unzip -tq -P ${quotePosixShellArg(password)} ${archive} 2>&1); password_test_status=$?; if [ "$password_test_status" -eq 82 ] || printf '%s' "$password_test_output" | grep -Eqi 'incorrect password|bad password'; then printf '${INVALID_PASSWORD_MARKER}\\n' >&2; exit 82; fi; if [ "$password_test_status" -ne 0 ]; then printf '%s\\n' "$password_test_output" >&2; exit "$password_test_status"; fi`;
      const passwordArg = password !== undefined ? `-P ${quotePosixShellArg(password)} ` : '';
      return `${cd} && ${preflight} && total=$(unzip -Z1 ${archive} 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"; unzip -o ${passwordArg}${archive}`;
    }
    if (kind === 'targz') return `${cd} && total=$(tar -tzf ${archive} 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"; tar -xzvf ${archive}`;
    return `${cd} && total=$(tar -tjf ${archive} 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"; tar -xjvf ${archive}`;
  }

  private detectArchiveKind(archivePath: string): ArchiveFormat | 'zip' | null {
    const lower = archivePath.toLowerCase();
    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz';
    if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tarbz2';
    return null;
  }

  private async commandExists(session: ReturnType<Pick<ExecutionSessionManager, 'require'>['require']>, command: string): Promise<boolean> {
    try {
      const result = await session.execute({ command: `command -v ${quotePosixShellArg(command)} >/dev/null 2>&1`, timeoutMs: 10_000, maxOutputBytes: 1024 });
      return result.exitCode === 0;
    } catch { return false; }
  }

  private validatePassword(password: string | undefined): { code: ArchiveErrorCode; message: string } | null {
    if (password === undefined) return null;
    if (!password.length || /[\0\r\n]/.test(password)) return { code: 'INVALID_PASSWORD_FORMAT', message: 'Archive password has an invalid format.' };
    if (Array.from(password).length > MAX_PASSWORD_LENGTH) return { code: 'PASSWORD_TOO_LONG', message: `Archive password must not exceed ${MAX_PASSWORD_LENGTH} characters.` };
    return null;
  }

  private parseFileLine(line: string, format: ArchiveFormat | 'zip'): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(TOTAL_MARKER) || trimmed.startsWith('zip warning:') || trimmed.startsWith('tar:')) return null;
    if (format === 'zip') {
      const match = trimmed.match(/^(?:adding|extracting|inflating|creating):\s+(.+?)(?:\s+\([^)]*\))?$/i);
      return match?.[1]?.trim() || null;
    }
    return trimmed.startsWith('/') ? null : trimmed;
  }

  private absolutePath(value: string, label: string): string {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
    if (!path.posix.isAbsolute(normalized)) throw new Error(`${label} must be absolute: ${value}`);
    return normalized;
  }

  private key(ownerId: string, requestId: string): string { return `${ownerId}\u0000${requestId}`; }

  private emitFailed(
    emit: (event: ArchiveEvent) => void,
    operation: ArchiveOperationKind,
    requestId: string,
    message: string,
    code?: ArchiveErrorCode,
    commandNotFound?: string,
  ): void {
    emit({ type: 'failed', operation, requestId, message, ...(code ? { code } : {}), ...(commandNotFound ? { commandNotFound } : {}) });
  }
}
