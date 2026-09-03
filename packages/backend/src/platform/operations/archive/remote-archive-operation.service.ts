import path from 'node:path';
import type { ExecutionSession } from '../../execution/execution-session';
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
  preflightAbort: AbortController;
  command?: RemoteCommandSession;
  cancelled: boolean;
}

const MAX_PASSWORD_LENGTH = 128;
const TOTAL_MARKER = '__NEXUS_ARCHIVE_TOTAL__:';
const PASSWORD_REQUIRED_MARKER = '__NEXUS_ARCHIVE_PASSWORD_REQUIRED__';
const INVALID_PASSWORD_MARKER = '__NEXUS_ARCHIVE_INVALID_PASSWORD__';

export class RemoteArchiveOperationService implements ArchiveOperation {
  private readonly activeByOwner = new Map<string, ActiveArchive>();

  constructor(private readonly sessions: Pick<ExecutionSessionManager, 'require'>) {}

  async compress(request: CompressArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void> {
    const passwordError = this.validatePassword(request.password);
    if (passwordError) {
      this.emitFailed(emit, 'compress', request.requestId, passwordError.message, passwordError.code);
      return;
    }
    if (request.password !== undefined && request.format !== 'zip') {
      this.emitFailed(
        emit,
        'compress',
        request.requestId,
        'Password protection is only supported for ZIP archives.',
        'UNSUPPORTED_FORMAT',
      );
      return;
    }
    if (!request.sourcePaths.length) {
      this.emitFailed(emit, 'compress', request.requestId, 'At least one source path is required.');
      return;
    }

    const destination = this.absolutePath(request.destinationPath, 'archive destination');
    const targetDirectory = path.posix.dirname(destination);
    const sourceArgs = request.sourcePaths.map((source) => {
      const normalized = this.absolutePath(source, 'archive source');
      const relative = path.posix.relative(targetDirectory, normalized);
      if (relative === '..' || relative.startsWith('../')) {
        throw new Error(`Archive source must be within destination directory: ${normalized}`);
      }
      const argument = relative || path.posix.basename(normalized);
      return `./${argument.replace(/^\.\/+/, '')}`;
    });
    const temporary = this.temporaryArchivePath(destination, request.requestId, request.format);
    const session = this.sessions.require(request.sessionId);
    const active = this.begin(request.ownerId, request.requestId, 'compress');

    try {
      const required = request.format === 'zip' ? 'zip' : 'tar';
      const commandAvailable = await this.commandExists(session, required, active);
      if (active.cancelled) {
        this.finish(active);
        this.emitCancelled(emit, active);
        return;
      }
      if (!commandAvailable) {
        this.finish(active);
        this.emitFailed(
          emit,
          'compress',
          request.requestId,
          `${required} is not installed on the remote server.`,
          'COMMAND_NOT_FOUND',
          required,
        );
        return;
      }

      const command = this.buildCompressCommand(
        request.format,
        targetDirectory,
        sourceArgs,
        temporary,
        request.password,
      );
      await this.runArchiveCommand(session, active, command, emit, request.format);
      if (active.cancelled) {
        this.finish(active);
        this.emitCancelled(emit, active);
        return;
      }
      const filesystem = await session.fileSystem('control');
      await filesystem.replaceFile(temporary, destination);
      this.finish(active);
      emit({ type: 'completed', operation: 'compress', requestId: request.requestId, path: destination });
    } catch (error) {
      this.finish(active);
      if (active.cancelled) this.emitCancelled(emit, active);
      else this.emitFailed(emit, 'compress', request.requestId, error instanceof Error ? error.message : String(error));
    } finally {
      const filesystem = await session.fileSystem('control').catch(() => null);
      await filesystem?.removeFile(temporary, { ignoreMissing: true }).catch(() => undefined);
      this.finish(active);
    }
  }

  async decompress(request: DecompressArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void> {
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
      this.emitFailed(
        emit,
        'decompress',
        request.requestId,
        'Passwords are only supported for ZIP archives.',
        'UNSUPPORTED_FORMAT',
      );
      return;
    }

    const session = this.sessions.require(request.sessionId);
    const active = this.begin(request.ownerId, request.requestId, 'decompress');
    try {
      const required = kind === 'zip' ? 'unzip' : 'tar';
      const commandAvailable = await this.commandExists(session, required, active);
      if (active.cancelled) {
        this.finish(active);
        this.emitCancelled(emit, active);
        return;
      }
      if (!commandAvailable) {
        this.finish(active);
        this.emitFailed(
          emit,
          'decompress',
          request.requestId,
          `${required} is not installed on the remote server.`,
          'COMMAND_NOT_FOUND',
          required,
        );
        return;
      }

      const result = await this.runArchiveCommand(
        session,
        active,
        this.buildDecompressCommand(archivePath, kind, request.password),
        emit,
        kind,
      );
      if (active.cancelled) {
        this.finish(active);
        this.emitCancelled(emit, active);
        return;
      }
      const combined = `${result.stdout}\n${result.stderr}`;
      if (combined.includes(PASSWORD_REQUIRED_MARKER)) {
        this.finish(active);
        this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is required.', 'PASSWORD_REQUIRED');
        return;
      }
      if (combined.includes(INVALID_PASSWORD_MARKER)) {
        this.finish(active);
        this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is invalid.', 'INVALID_PASSWORD');
        return;
      }
      this.finish(active);
      emit({
        type: 'completed',
        operation: 'decompress',
        requestId: request.requestId,
        path: path.posix.dirname(archivePath),
      });
    } catch (error) {
      this.finish(active);
      if (active.cancelled) this.emitCancelled(emit, active);
      else {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes(PASSWORD_REQUIRED_MARKER)) {
          this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is required.', 'PASSWORD_REQUIRED');
        } else if (message.includes(INVALID_PASSWORD_MARKER)) {
          this.emitFailed(emit, 'decompress', request.requestId, 'Archive password is invalid.', 'INVALID_PASSWORD');
        } else {
          this.emitFailed(emit, 'decompress', request.requestId, message);
        }
      }
    } finally {
      this.finish(active);
    }
  }

  async cancel(ownerId: string, requestId: string): Promise<boolean> {
    const active = this.activeByOwner.get(ownerId);
    if (!active || active.requestId !== requestId) return false;
    active.cancelled = true;
    active.preflightAbort.abort();
    await active.command?.terminate({ signal: 'TERM', graceMs: 800, forceMs: 2_500 }).catch(() => undefined);
    return true;
  }

  async cancelOwner(ownerId: string): Promise<void> {
    const active = this.activeByOwner.get(ownerId);
    if (active) await this.cancel(ownerId, active.requestId);
  }

  private begin(ownerId: string, requestId: string, operation: ArchiveOperationKind): ActiveArchive {
    const existing = this.activeByOwner.get(ownerId);
    if (existing) throw new Error(`Another archive operation is already running (${existing.requestId}).`);
    const active: ActiveArchive = {
      ownerId,
      requestId,
      operation,
      preflightAbort: new AbortController(),
      cancelled: false,
    };
    this.activeByOwner.set(ownerId, active);
    return active;
  }

  private finish(active: ActiveArchive): void {
    if (this.activeByOwner.get(active.ownerId) === active) this.activeByOwner.delete(active.ownerId);
  }

  private emitCancelled(emit: (event: ArchiveEvent) => void, active: ActiveArchive): void {
    emit({ type: 'cancelled', operation: active.operation, requestId: active.requestId });
  }

  private async runArchiveCommand(
    session: ExecutionSession,
    active: ActiveArchive,
    command: string,
    emit: (event: ArchiveEvent) => void,
    format: ArchiveFormat | 'zip',
  ): Promise<{ stdout: string; stderr: string }> {
    if (active.cancelled) throw new DOMException('Archive operation cancelled.', 'AbortError');
    const commandSession = await session.startCommand({ command, maxOutputBytes: 256 * 1024 });
    active.command = commandSession;
    if (active.cancelled) {
      await commandSession.terminate({ signal: 'TERM', graceMs: 200, forceMs: 1_000 }).catch(() => undefined);
      throw new DOMException('Archive operation cancelled.', 'AbortError');
    }

    let fileCount = 0;
    let totalFiles: number | undefined;
    let stdoutRemainder = '';
    let stderrRemainder = '';
    const consume = (data: Uint8Array, remainder: string): string => {
      const lines = `${remainder}${Buffer.from(data).toString('utf8')}`.split(/\r?\n/);
      const nextRemainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith(TOTAL_MARKER)) {
          const value = Number.parseInt(line.slice(TOTAL_MARKER.length).trim(), 10);
          if (Number.isFinite(value)) {
            totalFiles = value;
            emit({
              type: 'progress',
              operation: active.operation,
              requestId: active.requestId,
              fileCount,
              totalFiles,
              percent: totalFiles > 0 ? 0 : 100,
            });
          }
          continue;
        }
        const currentFile = this.parseFileLine(line, format);
        if (!currentFile) continue;
        fileCount += 1;
        emit({
          type: 'progress',
          operation: active.operation,
          requestId: active.requestId,
          fileCount,
          ...(totalFiles !== undefined
            ? {
                totalFiles,
                percent: totalFiles > 0 ? Math.min(100, Math.round((fileCount / totalFiles) * 100)) : 100,
              }
            : {}),
          currentFile,
        });
      }
      return nextRemainder;
    };
    const offOut = commandSession.onStdout((data) => {
      stdoutRemainder = consume(data, stdoutRemainder);
    });
    const offErr = commandSession.onStderr((data) => {
      stderrRemainder = consume(data, stderrRemainder);
    });
    try {
      const closeEvent = await new Promise<{ exitCode: number | null }>((resolve, reject) => {
        const offClose = commandSession.onClose((event) => {
          offClose();
          offError();
          resolve(event);
        });
        const offError = commandSession.onError((error) => {
          offClose();
          offError();
          reject(error);
        });
      });
      const snapshot = commandSession.snapshot();
      if (active.cancelled) throw new DOMException('Archive operation cancelled.', 'AbortError');
      if (closeEvent.exitCode !== 0) {
        throw new Error(
          snapshot.stderr.trim() || snapshot.stdout.trim() || `Archive command exited with ${closeEvent.exitCode}.`,
        );
      }
      return { stdout: snapshot.stdout, stderr: snapshot.stderr };
    } finally {
      offOut();
      offErr();
      if (active.command === commandSession) active.command = undefined;
    }
  }

  private buildCompressCommand(
    format: ArchiveFormat,
    directory: string,
    sources: readonly string[],
    temporaryPath: string,
    password?: string,
  ): string {
    const cd = `cd ${quotePosixShellArg(directory)}`;
    const quotedSources = sources.map((source) => quotePosixShellArg(source)).join(' ');
    const output = quotePosixShellArg(path.posix.basename(temporaryPath));
    const count = `total=$(find ${quotedSources} -print 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"`;
    if (format === 'zip') {
      const passwordArg = password !== undefined ? `-P ${quotePosixShellArg(password)} ` : '';
      return `${cd} && rm -f -- ${output} && ${count} && zip ${passwordArg}-r ${output} ${quotedSources}`;
    }
    if (format === 'targz') {
      return `${cd} && rm -f -- ${output} && ${count} && tar -czvf ${output} ${quotedSources}`;
    }
    return `${cd} && rm -f -- ${output} && ${count} && tar -cjvf ${output} ${quotedSources}`;
  }

  private buildDecompressCommand(archivePath: string, kind: ArchiveFormat | 'zip', password?: string): string {
    const directory = path.posix.dirname(archivePath);
    const basename = path.posix.basename(archivePath);
    const safeBasename = basename.startsWith('-') ? `./${basename}` : basename;
    const archive = quotePosixShellArg(safeBasename);
    const cd = `cd ${quotePosixShellArg(directory)}`;
    if (kind === 'zip') {
      const preflight =
        password === undefined
          ? `if LC_ALL=C unzip -Z -v ${archive} 2>/dev/null | grep -Eqi 'file security status:[[:space:]]*encrypted'; then printf '${PASSWORD_REQUIRED_MARKER}\\n' >&2; exit 82; fi`
          : `password_test_output=$(LC_ALL=C unzip -tq -P ${quotePosixShellArg(password)} ${archive} 2>&1); password_test_status=$?; if [ "$password_test_status" -eq 82 ] || printf '%s' "$password_test_output" | grep -Eqi 'incorrect password|bad password'; then printf '${INVALID_PASSWORD_MARKER}\\n' >&2; exit 82; fi; if [ "$password_test_status" -ne 0 ]; then printf '%s\\n' "$password_test_output" >&2; exit "$password_test_status"; fi`;
      const passwordArg = password !== undefined ? `-P ${quotePosixShellArg(password)} ` : '';
      const locale = [
        `nexus_utf8_locale=$(locale -a 2>/dev/null | grep -Eim1 '^(C\\.UTF-8|C\\.utf8|en_US\\.UTF-8|en_US\\.utf8)$' || true)`,
        `if [ -z "$nexus_utf8_locale" ]; then nexus_utf8_locale=$(locale -a 2>/dev/null | grep -Eim1 'utf-?8' || true); fi`,
        `if [ -z "$nexus_utf8_locale" ]; then nexus_utf8_locale=C.UTF-8; fi`,
      ].join('; ');
      return `${cd} && ${preflight} && total=$(unzip -Z1 ${archive} 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"; ${locale}; LC_ALL="$nexus_utf8_locale" unzip -o ${passwordArg}${archive}`;
    }
    if (kind === 'targz') {
      return `${cd} && total=$(tar -tzf ${archive} 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"; tar -xzvf ${archive}`;
    }
    return `${cd} && total=$(tar -tjf ${archive} 2>/dev/null | wc -l); printf '${TOTAL_MARKER}%s\\n' "$total"; tar -xjvf ${archive}`;
  }

  private detectArchiveKind(archivePath: string): ArchiveFormat | 'zip' | null {
    const lower = archivePath.toLowerCase();
    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz';
    if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tarbz2';
    return null;
  }

  private async commandExists(session: ExecutionSession, command: string, active: ActiveArchive): Promise<boolean> {
    try {
      const result = await session.execute({
        command: `command -v ${quotePosixShellArg(command)} >/dev/null 2>&1`,
        timeoutMs: 10_000,
        maxOutputBytes: 1_024,
        signal: active.preflightAbort.signal,
      });
      return result.exitCode === 0;
    } catch (error) {
      if (active.cancelled || active.preflightAbort.signal.aborted) return false;
      throw error;
    }
  }

  private temporaryArchivePath(destination: string, requestId: string, format: ArchiveFormat): string {
    const directory = path.posix.dirname(destination);
    const safeRequestId = requestId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'operation';
    const extension = format === 'zip' ? '.zip' : format === 'targz' ? '.tar.gz' : '.tar.bz2';
    return path.posix.join(directory, `.nexus-archive-${safeRequestId}.part${extension}`);
  }

  private validatePassword(password: string | undefined): { code: ArchiveErrorCode; message: string } | null {
    if (password === undefined) return null;
    if (!password.length || /[\0\r\n]/.test(password)) {
      return { code: 'INVALID_PASSWORD_FORMAT', message: 'Archive password has an invalid format.' };
    }
    if (Array.from(password).length > MAX_PASSWORD_LENGTH) {
      return {
        code: 'PASSWORD_TOO_LONG',
        message: `Archive password must not exceed ${MAX_PASSWORD_LENGTH} characters.`,
      };
    }
    return null;
  }

  private parseFileLine(line: string, format: ArchiveFormat | 'zip'): string | null {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith(TOTAL_MARKER) ||
      trimmed.startsWith('zip warning:') ||
      trimmed.startsWith('tar:')
    ) {
      return null;
    }
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

  private emitFailed(
    emit: (event: ArchiveEvent) => void,
    operation: ArchiveOperationKind,
    requestId: string,
    message: string,
    code?: ArchiveErrorCode,
    commandNotFound?: string,
  ): void {
    emit({
      type: 'failed',
      operation,
      requestId,
      message,
      ...(code ? { code } : {}),
      ...(commandNotFound ? { commandNotFound } : {}),
    });
  }
}
