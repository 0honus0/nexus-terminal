import * as pathModule from 'path';
import type { CommandSession } from '../../execution/command-session';
import type { ExecutionSession } from '../../execution/execution-session';
import { quotePosixShellArg } from '../../execution/posix-shell';
import { FileRemovalService } from '../../filesystem/file-removal.service';
import type {
  ArchiveCancelResult,
  ArchiveEventSink,
  ArchiveOperationContext,
  ArchiveOperationKind,
  CompressArchiveErrorCode,
  CompressArchiveRequest,
  DecompressArchiveErrorCode,
  DecompressArchiveRequest,
} from './archive.types';

const ARCHIVE_TOTAL_MARKER = '__NEXUS_ARCHIVE_TOTAL__:';
const ARCHIVE_WARNING_MARKER = '__NEXUS_ARCHIVE_WARNING__:';
const ARCHIVE_PASSWORD_REQUIRED_MARKER = '__NEXUS_ARCHIVE_PASSWORD_REQUIRED__';
const ARCHIVE_INVALID_PASSWORD_MARKER = '__NEXUS_ARCHIVE_INVALID_PASSWORD__';
const MAX_ARCHIVE_PASSWORD_LENGTH = 128;

type ArchivePasswordValidationError = {
  code: 'PASSWORD_TOO_LONG' | 'INVALID_PASSWORD_FORMAT';
  message: string;
};

const validateArchivePassword = (password: string | undefined): ArchivePasswordValidationError | null => {
  if (password === undefined) return null;
  if (password.length === 0) return { code: 'INVALID_PASSWORD_FORMAT', message: 'ZIP 密码不能为空' };
  if (Array.from(password).length > MAX_ARCHIVE_PASSWORD_LENGTH) {
    return { code: 'PASSWORD_TOO_LONG', message: `ZIP 密码不能超过 ${MAX_ARCHIVE_PASSWORD_LENGTH} 个字符` };
  }
  if (/[\0\r\n]/.test(password)) {
    return { code: 'INVALID_PASSWORD_FORMAT', message: 'ZIP 密码不能包含换行或空字符' };
  }
  return null;
};

interface ActiveArchiveOperation {
  context: ArchiveOperationContext;
  requestId: string;
  workspacePath?: string;
  commandSession: CommandSession;
  heartbeatInterval: ReturnType<typeof setInterval>;
  cancelled: boolean;
}

interface PendingArchiveOperation {
  context: ArchiveOperationContext;
  requestId: string;
  cancelled: boolean;
  preflightSession?: CommandSession;
}

/** Transport-neutral archive lifecycle reusable by Workspace and future Agent tasks. */
export class ArchiveOperationService {
  private readonly activeArchives = new Map<string, ActiveArchiveOperation>();
  private readonly pendingArchives = new Map<string, PendingArchiveOperation>();

  async cleanupOwner(ownerKey: string): Promise<void> {
    const requestIds = new Set<string>();
    for (const operation of this.activeArchives.values()) {
      if (operation.context.ownerKey === ownerKey) requestIds.add(operation.requestId);
    }
    for (const operation of this.pendingArchives.values()) {
      if (operation.context.ownerKey === ownerKey) requestIds.add(operation.requestId);
    }
    await Promise.allSettled([...requestIds].map((requestId) => this.cancel(ownerKey, requestId)));
  }

  async compress(context: ArchiveOperationContext, payload: CompressArchiveRequest): Promise<void> {
    const { ownerKey, session, emit } = context;
    const { sources, destinationArchiveName, format, targetDirectory, password, requestId } = payload;
    const archiveKey = `${ownerKey}:${requestId}`;

    if (!session.isReady) {
      this.emitError(emit, 'compress', 'SSH 会话未就绪', requestId);
      return;
    }

    const passwordError = validateArchivePassword(password);
    if (passwordError) {
      this.emitError(emit, 'compress', passwordError.message, requestId, undefined, passwordError.code);
      return;
    }
    if (password !== undefined && format !== 'zip') {
      this.emitError(emit, 'compress', '只有 ZIP 格式支持密码保护', requestId);
      return;
    }

    const requiredCommand = format === 'zip' ? 'zip' : 'tar';
    const pendingArchive: PendingArchiveOperation = { context, requestId, cancelled: false };
    this.pendingArchives.set(archiveKey, pendingArchive);
    try {
      if (!(await this.checkCommandExists(session, ownerKey, requiredCommand, pendingArchive))) {
        this.pendingArchives.delete(archiveKey);
        if (!pendingArchive.cancelled) {
          this.emitError(
            emit,
            'compress',
            `命令 '${requiredCommand}' 在服务器上未找到`,
            requestId,
            `Command '${requiredCommand}' not found on server.`,
          );
        }
        return;
      }
    } catch (checkError: any) {
      this.pendingArchives.delete(archiveKey);
      if (!pendingArchive.cancelled) {
        this.emitError(emit, 'compress', `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
      }
      return;
    }

    if (pendingArchive.cancelled) {
      this.pendingArchives.delete(archiveKey);
      return;
    }

    const extension = format === 'zip' ? '.zip' : format === 'targz' ? '.tar.gz' : '.tar.bz2';
    const safeRequestId = requestId.replace(/[^A-Za-z0-9_-]/g, '_');
    const workspaceName = `.nexus-archive-${safeRequestId}.work`;
    const workspacePath = pathModule.posix.join(targetDirectory, workspaceName);
    const relativeSources: string[] = [];
    for (const source of sources) {
      const relativePath = pathModule.posix.relative(targetDirectory, source);
      if (relativePath === '..' || relativePath.startsWith('../')) {
        this.pendingArchives.delete(archiveKey);
        this.emitError(emit, 'compress', `压缩源路径不在目标目录内: ${source}`, requestId);
        return;
      }
      const normalized = relativePath === '' || relativePath === '.' ? pathModule.posix.basename(source) : relativePath;
      relativeSources.push(`./${normalized.replace(/^\.\/+/, '')}`);
    }

    const workspaceRelativePath = `./${workspaceName}`;
    const temporaryArchiveRelativePath = `${workspaceRelativePath}/archive${extension}`;
    const destinationArchiveRelativePath = `./${destinationArchiveName}`;
    const quotedSources = relativeSources.map(quotePosixShellArg).join(' ');
    const quotedTargetDir = quotePosixShellArg(targetDirectory);
    const quotedWorkspace = quotePosixShellArg(workspaceRelativePath);
    const quotedTemporaryArchive = quotePosixShellArg(temporaryArchiveRelativePath);
    const quotedDestinationName = quotePosixShellArg(destinationArchiveRelativePath);
    const quotedPassword = password !== undefined ? quotePosixShellArg(password) : null;
    const countCommand = `total=$(find ${quotedSources} -print 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
    const archiveCommand =
      format === 'zip'
        ? `zip ${quotedPassword ? `-P ${quotedPassword} ` : ''}-b ${quotedWorkspace} -r ${quotedTemporaryArchive} ${quotedSources}`
        : format === 'targz'
          ? `tar -czvf ${quotedTemporaryArchive} ${quotedSources}`
          : `tar -cjvf ${quotedTemporaryArchive} ${quotedSources}`;
    const cleanupFunction = [
      'cleanup_archive() {',
      'status=$?;',
      'trap - EXIT HUP INT TERM;',
      'if [ -n "${archive_pid:-}" ]; then kill "$archive_pid" 2>/dev/null || true; stop_attempt=0; while kill -0 "$archive_pid" 2>/dev/null && [ "$stop_attempt" -lt 5 ]; do sleep 0.2; stop_attempt=$((stop_attempt + 1)); done; kill -9 "$archive_pid" 2>/dev/null || true; wait "$archive_pid" 2>/dev/null || true; fi;',
      `rm -rf -- ${quotedWorkspace};`,
      'exit "$status";',
      '}',
    ].join(' ');
    const archiveResultCheck =
      format === 'zip' && password === undefined
        ? `if [ "$archive_status" -ne 0 ]; then if [ -s ${quotedTemporaryArchive} ] && zip -T ${quotedTemporaryArchive} >/dev/null 2>&1; then printf '${ARCHIVE_WARNING_MARKER}%s\n' "$archive_status"; else exit "$archive_status"; fi; fi`
        : 'if [ "$archive_status" -ne 0 ]; then exit "$archive_status"; fi';
    const command = [
      `cd ${quotedTargetDir} || exit $?`,
      `rm -rf -- ${quotedWorkspace}`,
      `mkdir -p -- ${quotedWorkspace} || exit $?`,
      cleanupFunction,
      'trap cleanup_archive EXIT HUP INT TERM',
      countCommand,
      `${archiveCommand} & archive_pid=$!`,
      'wait "$archive_pid"; archive_status=$?; archive_pid=',
      archiveResultCheck,
      `mv -f -- ${quotedTemporaryArchive} ${quotedDestinationName}`,
    ].join('; ');

    try {
      const commandSession = await session.commands.start({ command, id: `archive:${requestId}` });
      this.pendingArchives.delete(archiveKey);
      if (pendingArchive.cancelled) {
        void this.stopArchiveCommandSession(commandSession).then(() =>
          this.removeRemoteArchiveWorkspace(session, ownerKey, workspacePath),
        );
        return;
      }

      let stderrData = '';
        let stdoutRemainder = '';
        let stderrRemainder = '';
        let fileCount = 0;
        let totalFiles: number | undefined;
        let archiveWarningCode: number | undefined;
        let archiveWarningData = '';
        let lastProgressTime = 0;
        let lastSeenFileName: string | undefined;
        let streamFinished = false;

        const sendProgress = (force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressTime < 1000) return;
          lastProgressTime = now;
          this.emitProgress(emit, 'compress', requestId, fileCount, lastSeenFileName, totalFiles);
        };
        const consumeOutput = (chunk: string, remainder: string): string => {
          const lines = `${remainder}${chunk}`.split(/\r?\n/);
          const nextRemainder = lines.pop() || '';
          for (const line of lines) {
            const parsedTotal = this.parseArchiveTotal(line);
            if (parsedTotal !== null) {
              totalFiles = parsedTotal > 0 ? parsedTotal : undefined;
              sendProgress(true);
              continue;
            }
            const parsedWarningCode = this.parseArchiveWarningCode(line);
            if (parsedWarningCode !== null) {
              archiveWarningCode = parsedWarningCode;
              continue;
            }
            if (/\b(?:zip|tar) warning:/i.test(line)) {
              archiveWarningData = this.appendBoundedOutput(archiveWarningData, `${line.trim()}\n`, 8192);
            }
            const fileName = this.parseArchiveFileName(line, format);
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          if (lastSeenFileName) sendProgress();
          return nextRemainder;
        };

        const heartbeatInterval = setInterval(() => sendProgress(true), 10000);
      const operation: ActiveArchiveOperation = {
        context,
        requestId,
        workspacePath,
        commandSession,
        heartbeatInterval,
        cancelled: false,
      };
      this.activeArchives.set(archiveKey, operation);

      commandSession.on('stdout', (data: Buffer) => {
        stdoutRemainder = consumeOutput(data.toString(), stdoutRemainder);
      });
      commandSession.on('stderr', (data: Buffer) => {
        const chunk = data.toString();
        stderrData = this.appendBoundedOutput(stderrData, chunk);
        stderrRemainder = consumeOutput(chunk, stderrRemainder);
      });
      commandSession.on('close', ({ exitCode }) => {
          if (streamFinished) return;
          streamFinished = true;
          clearInterval(heartbeatInterval);
          const active = this.activeArchives.get(archiveKey);
          if (active === operation) this.activeArchives.delete(archiveKey);
          if (operation.cancelled || !active) return;

          if (stdoutRemainder) stdoutRemainder = consumeOutput(`${stdoutRemainder}\n`, '');
          if (stderrRemainder) stderrRemainder = consumeOutput(`${stderrRemainder}\n`, '');
          if (fileCount > 0) sendProgress(true);
          if (exitCode === 0) {
            const warningDetails =
              archiveWarningData.trim() ||
              (archiveWarningCode !== undefined
                ? `ZIP 完成时返回警告代码 ${archiveWarningCode}，部分在压缩期间变化或消失的文件可能未包含在归档中。`
                : undefined);
            this.emitSuccess(
              emit,
              'compress',
              requestId,
              warningDetails ? '压缩完成，但存在警告' : '压缩成功',
              warningDetails,
            );
          } else {
            void this.removeRemoteArchiveWorkspace(session, ownerKey, workspacePath);
            const details = stderrData.trim() || `压缩命令退出，代码: ${exitCode ?? 'N/A'}`;
            this.emitError(emit, 'compress', '压缩失败', requestId, details);
          }
      });
      commandSession.on('error', (streamError: Error) => {
        if (streamFinished) return;
        streamFinished = true;
        clearInterval(heartbeatInterval);
        if (this.activeArchives.get(archiveKey) === operation) this.activeArchives.delete(archiveKey);
        if (operation.cancelled) return;
        void this.removeRemoteArchiveWorkspace(session, ownerKey, workspacePath);
        this.emitError(emit, 'compress', '压缩命令流错误', requestId, streamError.message);
      });
    } catch (execError: any) {
      this.pendingArchives.delete(archiveKey);
      void this.removeRemoteArchiveWorkspace(session, ownerKey, workspacePath);
      if (!pendingArchive.cancelled)
        this.emitError(emit, 'compress', `执行压缩时发生意外错误: ${execError.message}`, requestId);
    }
  }
  async cancel(ownerKey: string, requestId: string): Promise<ArchiveCancelResult> {
    const archiveKey = `${ownerKey}:${requestId}`;
    const operation = this.activeArchives.get(archiveKey);
    const pending = this.pendingArchives.get(archiveKey);

    let cleaned = true;
    if (operation) {
      operation.cancelled = true;
      this.activeArchives.delete(archiveKey);
      clearInterval(operation.heartbeatInterval);
      await this.stopArchiveCommandSession(operation.commandSession);
      if (operation.workspacePath) {
        cleaned = await this.removeRemoteArchiveWorkspace(
          operation.context.session,
          operation.context.ownerKey,
          operation.workspacePath,
        );
      }
    } else if (pending) {
      // Cancellation remains attached to the actual request until preflight exits.
      // Do not use a time-based marker: a stalled SSH exec may resume much later.
      pending.cancelled = true;
      await pending.preflightSession?.terminate();
    }

    return { found: Boolean(operation || pending), cleaned };
  }
  private async stopArchiveCommandSession(commandSession: CommandSession): Promise<void> {
    await commandSession.terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 });
  }
  async decompress(context: ArchiveOperationContext, payload: DecompressArchiveRequest): Promise<void> {
    const { ownerKey, session, emit } = context;
    const { archivePath, password, requestId } = payload;
    const archiveKey = `${ownerKey}:${requestId}`;

    if (!session.isReady) {
      console.warn(`[Archive ${ownerKey}] execution session is not ready for decompress (ID: ${requestId})`);
      this.emitError(emit, 'decompress', 'SSH 会话未就绪', requestId);
      return;
    }

    const lowerArchivePath = archivePath.toLowerCase(); // 在此声明一次

    const passwordError = validateArchivePassword(password);
    if (passwordError) {
      this.emitError(emit, 'decompress', passwordError.message, requestId, undefined, passwordError.code);
      return;
    }
    if (password !== undefined && !lowerArchivePath.endsWith('.zip')) {
      this.emitError(emit, 'decompress', '只有 ZIP 格式支持密码解压', requestId);
      return;
    }

    // 命令检查
    let requiredCommand = '';
    // 使用已经声明的 lowerArchivePath
    if (lowerArchivePath.endsWith('.zip')) {
      requiredCommand = 'unzip';
    } else if (
      lowerArchivePath.endsWith('.tar.gz') ||
      lowerArchivePath.endsWith('.tgz') ||
      lowerArchivePath.endsWith('.tar.bz2') ||
      lowerArchivePath.endsWith('.tbz2')
    ) {
      requiredCommand = 'tar';
    } else {
      this.emitError(emit, 'decompress', `不支持的压缩文件格式: ${archivePath}`, requestId);
      return;
    }

    const pendingArchive: PendingArchiveOperation = { context, requestId, cancelled: false };
    this.pendingArchives.set(archiveKey, pendingArchive);
    try {
      const commandExists = await this.checkCommandExists(session, ownerKey, requiredCommand, pendingArchive);
      if (!commandExists) {
        this.pendingArchives.delete(archiveKey);
        if (!pendingArchive.cancelled) {
          this.emitError(
            emit,
            'decompress',
            `命令 '${requiredCommand}' 在服务器上未找到`,
            requestId,
            `Command '${requiredCommand}' not found on server.`,
          );
        }
        return;
      }
    } catch (checkError: any) {
      this.pendingArchives.delete(archiveKey);
      if (!pendingArchive.cancelled) {
        this.emitError(emit, 'decompress', `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
      }
      return;
    }
    if (pendingArchive.cancelled) {
      this.pendingArchives.delete(archiveKey);
      return;
    }

    console.debug(`[SFTP Decompress ${ownerKey}] Received request for ${archivePath} (ID: ${requestId})`);

    const extractDir = pathModule.posix.dirname(archivePath);
    const archiveBasename = pathModule.posix.basename(archivePath);
    const safeArchiveArgument = archiveBasename.startsWith('-') ? `./${archiveBasename}` : archiveBasename;

    // --- 构建 Shell 命令 ---
    let command: string;
    // 确保路径被正确引用
    const quotedExtractDir = quotePosixShellArg(extractDir);
    const quotedArchiveBasename = quotePosixShellArg(safeArchiveArgument);
    const quotedPassword = password !== undefined ? quotePosixShellArg(password) : null;

    const cdCommand = `cd ${quotedExtractDir}`;

    // 使用在方法开始处声明的 lowerArchivePath
    if (lowerArchivePath.endsWith('.zip')) {
      // Detect encryption before extraction so a mixed archive is never partially
      // unpacked while we are only discovering that a password is required.
      const passwordPreflight = quotedPassword
        ? [
            `password_test_output=$(LC_ALL=C unzip -tq -P ${quotedPassword} ${quotedArchiveBasename} 2>&1)`,
            'password_test_status=$?',
            `if [ "$password_test_status" -eq 82 ] || printf '%s' "$password_test_output" | grep -Eqi 'incorrect password|bad password'; then printf '${ARCHIVE_INVALID_PASSWORD_MARKER}\n' >&2; exit 82; fi`,
            'if [ "$password_test_status" -ne 0 ]; then printf "%s\n" "$password_test_output" >&2; exit "$password_test_status"; fi',
          ].join('; ')
        : `if LC_ALL=C unzip -Z -v ${quotedArchiveBasename} 2>/dev/null | grep -Eqi 'file security status:[[:space:]]*encrypted'; then printf '${ARCHIVE_PASSWORD_REQUIRED_MARKER}\n' >&2; exit 82; fi`;
      const passwordOption = quotedPassword ? `-P ${quotedPassword} ` : '';
      const countCommand = `total=$(unzip -Z1 ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
      // Info-ZIP turns Unicode Path extra fields into #Uxxxx names under the
      // C/POSIX locale. Extract under an available UTF-8 locale instead.
      const utf8LocaleCommand = [
        '{',
        `nexus_utf8_locale=$(locale -a 2>/dev/null | grep -Eim1 '^(C\\.UTF-8|C\\.utf8|en_US\\.UTF-8|en_US\\.utf8)$' || true);`,
        `if [ -z "$nexus_utf8_locale" ]; then nexus_utf8_locale=$(locale -a 2>/dev/null | grep -Eim1 'utf-?8' || true); fi;`,
        `if [ -z "$nexus_utf8_locale" ]; then nexus_utf8_locale=C.UTF-8; fi;`,
        '}',
      ].join(' ');
      command = `${cdCommand} && ${passwordPreflight} && ${countCommand} && ${utf8LocaleCommand} && LC_ALL="$nexus_utf8_locale" unzip -o ${passwordOption}${quotedArchiveBasename}`;
    } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
      const countCommand = `total=$(tar -tzf ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
      command = `${cdCommand} && ${countCommand} && tar -xzvf ${quotedArchiveBasename}`;
    } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
      const countCommand = `total=$(tar -tjf ${quotedArchiveBasename} 2>/dev/null | wc -l); printf '${ARCHIVE_TOTAL_MARKER}%s\n' "$total"`;
      command = `${cdCommand} && ${countCommand} && tar -xjvf ${quotedArchiveBasename}`;
    } else {
      this.emitError(emit, 'decompress', `不支持的压缩文件格式: ${archivePath}`, requestId);
      return;
    }

    if (password === undefined) {
      console.log(`[SFTP Decompress ${ownerKey}] Executing command: ${command} (ID: ${requestId})`);
    } else {
      console.log(`[SFTP Decompress ${ownerKey}] Executing password-protected ZIP extraction (ID: ${requestId})`);
    }

    if (pendingArchive.cancelled) {
      this.pendingArchives.delete(archiveKey);
      return;
    }

    // --- 执行命令 ---
    try {
      const commandSession = await session.commands.start({ command, id: `archive:${requestId}` });
      this.pendingArchives.delete(archiveKey);
      if (pendingArchive.cancelled) {
        void this.stopArchiveCommandSession(commandSession);
        return;
      }

      let stderrData = '';
        let stdoutRemainder = '';
        let stderrRemainder = '';
        let code: number | null = null;
        let fileCount = 0;
        let totalFiles: number | undefined;
        let lastProgressTime = 0;
        let lastSeenFileName: string | undefined;
        let streamFinished = false;
        const progressFormat: 'decompress' | 'targz' | 'tarbz2' = lowerArchivePath.endsWith('.zip')
          ? 'decompress'
          : lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')
            ? 'tarbz2'
            : 'targz';

        const sendProgress = (force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressTime < 1000) return;
          lastProgressTime = now;
          this.emitProgress(emit, 'decompress', requestId, fileCount, lastSeenFileName, totalFiles);
        };

        const consumeOutput = (chunk: string, remainder: string): string => {
          const lines = `${remainder}${chunk}`.split(/\r?\n/);
          const nextRemainder = lines.pop() || '';
          for (const line of lines) {
            const parsedTotal = this.parseArchiveTotal(line);
            if (parsedTotal !== null) {
              totalFiles = parsedTotal > 0 ? parsedTotal : undefined;
              sendProgress(true);
              continue;
            }
            const fileName = this.parseArchiveFileName(line, progressFormat);
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          if (lastSeenFileName) sendProgress();
          return nextRemainder;
        };

      const heartbeatInterval = setInterval(() => sendProgress(true), 10000);
      const operation: ActiveArchiveOperation = {
        context,
        requestId,
        commandSession,
        heartbeatInterval,
        cancelled: false,
      };
      this.activeArchives.set(archiveKey, operation);

      commandSession.on('stdout', (data: Buffer) => {
        // 必须持续消费 stdout，否则大型归档会耗尽 SSH 通道窗口并永久挂起。
        stdoutRemainder = consumeOutput(data.toString(), stdoutRemainder);
      });
      commandSession.on('stderr', (data: Buffer) => {
        const chunk = data.toString();
        stderrData = this.appendBoundedOutput(stderrData, chunk);
        stderrRemainder = consumeOutput(chunk, stderrRemainder);
      });

      commandSession.on('close', ({ exitCode }) => {
          if (streamFinished) return;
          streamFinished = true;
          clearInterval(heartbeatInterval);
          const active = this.activeArchives.get(archiveKey);
          if (active === operation) this.activeArchives.delete(archiveKey);
          if (operation.cancelled || !active) return;
          if (stdoutRemainder) stdoutRemainder = consumeOutput(`${stdoutRemainder}\n`, '');
          if (stderrRemainder) stderrRemainder = consumeOutput(`${stderrRemainder}\n`, '');
          code = exitCode;
          if (fileCount > 0) sendProgress(true);

          const trimmedStderr = stderrData.trim();
          const passwordRequired =
            lowerArchivePath.endsWith('.zip') &&
            password === undefined &&
            (trimmedStderr.includes(ARCHIVE_PASSWORD_REQUIRED_MARKER) ||
              code === 82 ||
              /unable to get password|password required/i.test(trimmedStderr));
          const invalidPassword =
            lowerArchivePath.endsWith('.zip') &&
            password !== undefined &&
            (trimmedStderr.includes(ARCHIVE_INVALID_PASSWORD_MARKER) ||
              code === 82 ||
              /incorrect password|bad password/i.test(trimmedStderr));

          if (passwordRequired) {
            console.log(`[SFTP Decompress ${ownerKey}] ZIP requires a password (ID: ${requestId}).`);
            this.emitError(emit, 'decompress', '该 ZIP 文件需要密码', requestId, undefined, 'PASSWORD_REQUIRED');
            return;
          }
          if (invalidPassword) {
            console.warn(`[SFTP Decompress ${ownerKey}] ZIP password was rejected (ID: ${requestId}).`);
            this.emitError(emit, 'decompress', 'ZIP 密码不正确', requestId, undefined, 'INVALID_PASSWORD');
            return;
          }

          console.log(
            `[SFTP Decompress ${ownerKey}] Command finished with code ${code} (ID: ${requestId}). Stderr: ${trimmedStderr}`,
          );
          if (code === 0 && !this.isErrorInStdErr(stderrData)) {
            // 检查退出码和 stderr
            console.log(`[SFTP Decompress ${ownerKey}] Decompression successful (ID: ${requestId}).`);
            this.emitSuccess(emit, 'decompress', requestId, '解压成功');
          } else {
            const errorDetails = stderrData.trim() || `解压命令退出，代码: ${code ?? 'N/A'}`;
            console.error(`[SFTP Decompress ${ownerKey}] Decompression failed (ID: ${requestId}): ${errorDetails}`);
            this.emitError(emit, 'decompress', '解压失败', requestId, errorDetails);
          }
      });
      commandSession.on('error', (streamErr: Error) => {
        if (streamFinished) return;
        streamFinished = true;
        clearInterval(heartbeatInterval);
        if (this.activeArchives.get(archiveKey) === operation) this.activeArchives.delete(archiveKey);
        if (operation.cancelled) return;
        console.error(`[SFTP Decompress ${ownerKey}] Command stream error (ID: ${requestId}):`, streamErr);
        this.emitError(emit, 'decompress', '解压命令流错误', requestId, streamErr.message);
      });
    } catch (execError: any) {
      this.pendingArchives.delete(archiveKey);
      console.error(
        `[SFTP Decompress ${ownerKey}] Decompress command caught unexpected error during exec setup (ID: ${requestId}):`,
        execError,
      );
      if (!pendingArchive.cancelled)
        this.emitError(emit, 'decompress', `执行解压时发生意外错误: ${execError.message}`, requestId);
    }
  }
  private async checkCommandExists(
    session: ExecutionSession,
    ownerKey: string,
    commandName: string,
    pendingArchive?: PendingArchiveOperation,
  ): Promise<boolean> {
    if (!session.isReady) throw new Error('SSH client is not available.');

    const checkCommands = [`command -v ${commandName}`, `which ${commandName}`];
    for (let index = 0; index < checkCommands.length; index += 1) {
      if (pendingArchive?.cancelled) throw new Error('ARCHIVE_CANCELLED');

      const checkCmd = checkCommands[index];
      console.log(`[SFTP Command Check ${ownerKey}] Executing: ${checkCmd}`);

      let commandSession: CommandSession;
      try {
        commandSession = await session.commands.start({
          command: checkCmd,
          id: `archive-preflight:${pendingArchive?.requestId ?? commandName}:${index}`,
        });
      } catch (error) {
        console.error(`[SFTP Command Check ${ownerKey}] Failed to start exec for "${checkCmd}":`, error);
        continue;
      }

      if (pendingArchive) pendingArchive.preflightSession = commandSession;
      if (pendingArchive?.cancelled) {
        await commandSession.terminate();
        if (pendingArchive.preflightSession === commandSession) pendingArchive.preflightSession = undefined;
        throw new Error('ARCHIVE_CANCELLED');
      }

      let output = '';
      const result = await new Promise<{ exitCode?: number | null; error?: Error; timedOut?: boolean }>((resolve) => {
        let settled = false;
        const finish = (value: { exitCode?: number | null; error?: Error; timedOut?: boolean }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const timeout = setTimeout(() => {
          if (settled) return;
          void commandSession.terminate().finally(() => finish({ timedOut: true }));
        }, 10_000);
        timeout.unref?.();

        commandSession.on('stdout', (data: Buffer) => {
          output += data.toString();
        });
        commandSession.on('stderr', () => {
          /* consumed by CommandSession to avoid channel backpressure */
        });
        commandSession.once('close', ({ exitCode }) => finish({ exitCode }));
        commandSession.once('error', (error: Error) => finish({ error }));
      });

      if (pendingArchive?.preflightSession === commandSession) pendingArchive.preflightSession = undefined;
      if (pendingArchive?.cancelled) throw new Error('ARCHIVE_CANCELLED');
      if (result.timedOut) throw new Error(`Command check timed out for '${commandName}'`);
      if (result.error) {
        console.error(`[SFTP Command Check ${ownerKey}] Stream error for "${checkCmd}":`, result.error);
        continue;
      }
      if (result.exitCode === 0 && output.trim() !== '') {
        console.log(
          `[SFTP Command Check ${ownerKey}] Command '${commandName}' found using "${checkCmd}". Output: ${output.trim()}`,
        );
        return true;
      }

      console.log(
        `[SFTP Command Check ${ownerKey}] Command '${commandName}' not found with "${checkCmd}" (code: ${result.exitCode}, output: "${output.trim()}").`,
      );
    }

    return false;
  }
  private emitError(
    emit: ArchiveEventSink,
    operation: ArchiveOperationKind,
    error: string,
    requestId: string,
    details?: string,
    code?: CompressArchiveErrorCode | DecompressArchiveErrorCode,
  ): void {
    const commandNotFound = error.includes('在服务器上未找到')
      ? error.match(/'([^']+)'/)?.[1] || 'unknown'
      : undefined;
    emit({
      type: 'error',
      operation,
      error,
      requestId,
      ...(details ? { details } : {}),
      ...(code ? { code } : {}),
      ...(commandNotFound ? { commandNotFound } : {}),
    });
  }

  private emitSuccess(
    emit: ArchiveEventSink,
    operation: ArchiveOperationKind,
    requestId: string,
    message: string,
    warning?: string,
  ): void {
    emit({ type: 'success', operation, requestId, message, ...(warning ? { warning } : {}) });
  }
  private appendBoundedOutput(existing: string, chunk: string, maxLength = 65536): string {
    const combined = existing + chunk;
    return combined.length > maxLength ? combined.slice(-maxLength) : combined;
  }
  private parseArchiveTotal(line: string): number | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ARCHIVE_TOTAL_MARKER)) return null;
    const total = Number.parseInt(trimmed.slice(ARCHIVE_TOTAL_MARKER.length), 10);
    return Number.isFinite(total) && total >= 0 ? total : 0;
  }
  private parseArchiveWarningCode(line: string): number | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ARCHIVE_WARNING_MARKER)) return null;
    const code = Number.parseInt(trimmed.slice(ARCHIVE_WARNING_MARKER.length), 10);
    return Number.isFinite(code) && code > 0 ? code : 0;
  }
  private parseArchiveFileName(line: string, format: 'zip' | 'targz' | 'tarbz2' | 'decompress'): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (format === 'zip') {
      const match = trimmed.match(/^adding:\s+(.+?)(?:\s+\(.*\))?$/i);
      return match?.[1]?.trim() || null;
    }

    if (format === 'decompress') {
      const match = trimmed.match(/^(?:inflating|extracting|creating):\s+(.+)/i);
      return match?.[1]?.trim() || null;
    }

    if (
      !trimmed.startsWith('/') &&
      !/^tar(?:\s|:|\()/i.test(trimmed) &&
      trimmed.length < 1024 &&
      !/^[A-Za-z]+:\s/.test(trimmed)
    ) {
      return trimmed;
    }
    return null;
  }
  private emitProgress(
    emit: ArchiveEventSink,
    operation: ArchiveOperationKind,
    requestId: string,
    fileCount: number,
    currentFile?: string,
    totalFiles?: number,
  ): void {
    const percent = totalFiles && totalFiles > 0
      ? Math.min(100, Math.round((fileCount / totalFiles) * 100))
      : undefined;
    emit({
      type: 'progress',
      operation,
      requestId,
      fileCount,
      ...(totalFiles !== undefined ? { totalFiles } : {}),
      ...(percent !== undefined ? { percent } : {}),
      ...(currentFile ? { currentFile } : {}),
    });
  }
  private isErrorInStdErr(stderr: string): boolean {
    if (!stderr || stderr.trim().length === 0) {
      return false; // 空 stderr 不是错误
    }
    const lowerStderr = stderr.toLowerCase();
    // 常见的错误关键词或模式
    const errorPatterns = [
      'error',
      'fail',
      'cannot',
      'not found',
      'no such file',
      'permission denied',
      'invalid',
      '不支持',
    ];
    // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
    if (
      /[\d.]+%/.test(stderr) ||
      /adding:/.test(lowerStderr) ||
      /inflating:/.test(lowerStderr) ||
      /extracting:/.test(lowerStderr)
    ) {
      // 忽略一些明确的非错误输出
      if (errorPatterns.some((pattern) => lowerStderr.includes(pattern))) {
        // 如果进度信息中包含错误关键词，则可能真的是错误
        return true;
      }
      return false;
    }

    return errorPatterns.some((pattern) => lowerStderr.includes(pattern));
  }

  private async removeRemoteArchiveWorkspace(
    session: ExecutionSession,
    ownerKey: string,
    workspacePath: string,
  ): Promise<boolean> {
    if (!session.isReady) return false;
    try {
      await new FileRemovalService(session).removePath(workspacePath);
      return true;
    } catch (error) {
      console.warn(`[Archive ${ownerKey}] Failed to remove workspace ${workspacePath}:`, error);
      return false;
    }
  }
}
