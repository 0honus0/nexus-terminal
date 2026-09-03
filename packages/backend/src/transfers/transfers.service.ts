import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Client, SFTPWrapper, ExecOptions } from 'ssh2';
import { InitiateTransferPayload, TransferTask, TransferSubTask } from './transfers.types';
import { quotePosixShellArg } from '../utils/shell';
import { executeSshCommand } from '../execution/ssh-command-executor';
import { CommandSessionManager } from '../execution/command-session-manager';
import { sshCredentialResolver } from '../transport/ssh/ssh-credential-resolver';
import { sshConnectionFactory } from '../transport/ssh/ssh-connection-factory';
import type { ResolvedSshConnection } from '../transport/ssh/ssh-connection.types';

export class TransfersService {
  private transferTasks: Map<string, TransferTask> = new Map();
  private taskAbortControllers: Map<string, AbortController> = new Map(); // +++ 用于存储任务的 AbortController +++
  private readonly TEMP_KEY_PREFIX = 'nexus_target_key_';
  private readonly MAX_CONCURRENT_SUB_TASKS = 5;

  constructor() {
    console.info('[TransfersService] Initialized.');
  }

  private isFinalTaskStatus(status: TransferTask['status']): boolean {
    return ['completed', 'failed', 'partially-completed', 'cancelled'].includes(status);
  }

  public removeTransferTask(taskId: string, userId: string | number): 'removed' | 'not-found' | 'active' {
    const task = this.transferTasks.get(taskId);
    if (!task || task.userId !== userId) {
      return 'not-found';
    }
    // Never hide a task while an AbortController can still own live SSH channels.
    if (!this.isFinalTaskStatus(task.status) || this.taskAbortControllers.has(taskId)) {
      return 'active';
    }
    this.transferTasks.delete(taskId);
    return 'removed';
  }

  public async initiateNewTransfer(payload: InitiateTransferPayload, userId: string | number): Promise<TransferTask> {
    const taskId = uuidv4();
    const now = new Date();
    const subTasks: TransferSubTask[] = [];
    const abortController = new AbortController();
    this.taskAbortControllers.set(taskId, abortController);

    // 每个 (目标服务器, 源文件) 组合都是一个子任务
    for (const connectionId of payload.connectionIds) {
      // 目标服务器ID列表
      for (const item of payload.sourceItems) {
        // 源服务器上的文件/目录列表
        const subTaskId = uuidv4();
        subTasks.push({
          subTaskId,
          connectionId, // 这是目标服务器的ID
          sourceItemName: item.name, // 源文件的名称，用于标识
          status: 'queued',
          startTime: now,
        });
      }
    }

    const newTask: TransferTask = {
      taskId,
      status: 'queued',
      userId,
      createdAt: now,
      updatedAt: now,
      subTasks,
      payload, // payload 包含 sourceConnectionId
    };

    this.transferTasks.set(taskId, newTask);
    console.info(
      `[TransfersService] New transfer task created: ${taskId} for source ${payload.sourceConnectionId} with ${subTasks.length} sub-tasks.`,
    );

    // 异步启动传输，不阻塞当前请求
    this.processTransferTask(taskId, abortController.signal).catch((error) => {
      // +++ 传递 signal +++
      console.error(`[TransfersService] Error processing task ${taskId} in background:`, error);
      // 如果不是因为终止操作导致的错误，则更新状态
      if (error.name !== 'AbortError') {
        this.updateOverallTaskStatus(taskId, 'failed', `Background processing error: ${error.message}`);
      }
    });

    return { ...newTask }; // 返回任务的副本
  }

  public async cancelTransferTask(taskId: string, userId: string | number): Promise<boolean> {
    const task = this.transferTasks.get(taskId);
    if (!task || task.userId !== userId) {
      console.warn(
        `[TransfersService] Attempt to cancel non-existent task ${taskId} or task not owned by user ${userId}.`,
      );
      return false;
    }
    if (this.isFinalTaskStatus(task.status)) {
      return false;
    }

    const abortController = this.taskAbortControllers.get(taskId);
    if (!abortController) {
      console.warn(`[TransfersService] No AbortController found for active task ${taskId}.`);
      return false;
    }
    if (abortController.signal.aborted) {
      return true;
    }

    console.info(`[TransfersService] Cancelling task ${taskId}.`);
    this.updateOverallTaskStatus(taskId, 'cancelling', 'Task cancellation initiated by user.');
    task.subTasks.forEach((subTask) => {
      if (!['completed', 'failed', 'cancelled'].includes(subTask.status)) {
        this.updateSubTaskStatus(
          taskId,
          subTask.subTaskId,
          'cancelled',
          subTask.progress,
          'Cancelled due to parent task cancellation.',
        );
      }
    });
    // Abort after the status transition so synchronous abort listeners cannot race the UI
    // back to an in-progress aggregate state.
    abortController.abort();
    return true;
  }

  private async processTransferTask(taskId: string, signal: AbortSignal): Promise<void> {
    // +++ 接收 AbortSignal +++
    const task = this.transferTasks.get(taskId);
    if (!task) {
      console.error(`[TransfersService] Task ${taskId} not found for processing.`);
      return;
    }

    if (signal.aborted) {
      console.info(`[TransfersService] Task ${taskId} was cancelled before processing started.`);
      this.updateOverallTaskStatus(taskId, 'cancelled', 'Cancelled before start.');
      this.taskAbortControllers.delete(taskId); // 清理
      return;
    }

    this.updateOverallTaskStatus(taskId, 'in-progress');
    let sourceSshClient: Client | undefined;

    try {
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      const sourceConnection = await sshCredentialResolver.resolveStored(task.payload.sourceConnectionId);
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      sourceSshClient = await sshConnectionFactory.connect(sourceConnection, undefined, signal);
      console.info(
        `[TransfersService] SSH connection established to source server ${sourceConnection.host} for task ${taskId}.`,
      );

      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      // New concurrent processing logic for sub-tasks
      const subTaskExecutionPromises: Promise<void>[] = []; // Stores promises for all initiated sub-tasks
      let currentlyActiveSubTasks = 0;
      const maxConcurrentSubTasks = this.MAX_CONCURRENT_SUB_TASKS;
      let currentSubTaskIndex = 0; // Points to the next sub-task in task.subTasks to be processed
      const totalSubTasks = task.subTasks.length;

      console.info(
        `[TransfersService] Task ${taskId}: Starting to process ${totalSubTasks} sub-tasks with max concurrency of ${maxConcurrentSubTasks}.`,
      );

      // Wrapper function to process a single sub-task and manage active counts
      const processSingleSubTaskWrapper = async (
        subTask: TransferSubTask,
        subTaskIndexForLog: number,
      ): Promise<void> => {
        console.info(
          `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (index ${subTaskIndexForLog}) started. Active: ${currentlyActiveSubTasks}/${maxConcurrentSubTasks}`,
        );

        if (signal.aborted) {
          this.updateSubTaskStatus(taskId, subTask.subTaskId, 'cancelled', undefined, 'Cancelled before start.');
          console.info(`[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} cancelled before processing.`);
          return; // Do not process this sub-task
        }

        const currentSourceItem = task.payload.sourceItems.find((it) => it.name === subTask.sourceItemName);
        if (!currentSourceItem) {
          this.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'failed',
            undefined,
            `Source item '${subTask.sourceItemName}' not found in payload.`,
          );
          console.warn(
            `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (item: ${subTask.sourceItemName}) - Source item not found.`,
          );
          return;
        }

        try {
          if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
          this.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'connecting',
            undefined,
            `Preparing transfer for ${currentSourceItem.name} to target ID ${subTask.connectionId}`,
          );
          console.info(
            `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}) - Connecting to target ID ${subTask.connectionId}.`,
          );

          const targetConnection = await sshCredentialResolver.resolveStored(subTask.connectionId);
          if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

          await this.executeRemoteTransferOnSource(
            taskId,
            subTask.subTaskId,
            sourceSshClient!,
            currentSourceItem,
            targetConnection,
            task.payload.remoteTargetPath,
            task.payload.transferMethod,
            signal, // +++ Pass signal +++
          );
        } catch (subTaskError: any) {
          if (subTaskError.name === 'AbortError') {
            this.updateSubTaskStatus(taskId, subTask.subTaskId, 'cancelled', undefined, 'Sub-task cancelled by user.');
            console.info(
              `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}) was cancelled.`,
            );
          } else {
            console.error(
              `[TransfersService] Task ${taskId}: Error in sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}) wrapper:`,
              subTaskError.message,
              subTaskError.stack,
            );
            const subTaskInstance = task.subTasks.find((st) => st.subTaskId === subTask.subTaskId);
            if (
              subTaskInstance &&
              subTaskInstance.status !== 'failed' &&
              subTaskInstance.status !== 'completed' &&
              subTaskInstance.status !== 'cancelled'
            ) {
              this.updateSubTaskStatus(
                taskId,
                subTask.subTaskId,
                'failed',
                undefined,
                subTaskError.message || `Unknown error in sub-task ${subTask.subTaskId} wrapper.`,
              );
            }
          }
        }
      };

      await new Promise<void>((resolveAllTasksCompleted, rejectAllTasksCompleted) => {
        const onAbortOverall = () => {
          console.info(
            `[TransfersService] Task ${taskId}: Overall cancellation signal received during sub-task processing phase.`,
          );
          // Attempt to clean up / signal running sub-tasks is handled by individual sub-task signal checks
          rejectAllTasksCompleted(new DOMException('Transfer cancelled by user.', 'AbortError'));
        };
        signal.addEventListener('abort', onAbortOverall, { once: true });

        const launchNextSubTaskIfPossible = () => {
          if (signal.aborted) {
            // Check before launching new sub-tasks
            console.info(`[TransfersService] Task ${taskId}: Abort signal detected, not launching more sub-tasks.`);
            if (currentlyActiveSubTasks === 0) resolveAllTasksCompleted(); // If no tasks are active, resolve.
            return;
          }

          while (currentlyActiveSubTasks < maxConcurrentSubTasks && currentSubTaskIndex < totalSubTasks) {
            const subTaskToProcess = task.subTasks[currentSubTaskIndex];
            // If sub-task is already marked (e.g. cancelled by overall cancel before it started), skip.
            if (subTaskToProcess.status === 'cancelled') {
              console.info(
                `[TransfersService] Task ${taskId}: Skipping already cancelled sub-task ${subTaskToProcess.subTaskId}`,
              );
              currentSubTaskIndex++;
              if (currentSubTaskIndex === totalSubTasks && currentlyActiveSubTasks === 0) {
                signal.removeEventListener('abort', onAbortOverall);
                resolveAllTasksCompleted();
              }
              continue; // check next sub-task
            }

            const capturedIndexForLog = currentSubTaskIndex;
            currentlyActiveSubTasks++;
            currentSubTaskIndex++;

            const taskPromise = processSingleSubTaskWrapper(subTaskToProcess, capturedIndexForLog).finally(() => {
              currentlyActiveSubTasks--;
              if (signal.aborted && currentlyActiveSubTasks === 0) {
                console.info(
                  `[TransfersService] Task ${taskId}: All active sub-tasks finished after main abort signal.`,
                );
                signal.removeEventListener('abort', onAbortOverall);
                resolveAllTasksCompleted(); // All active tasks completed/aborted after main signal
                return;
              }
              if (currentSubTaskIndex < totalSubTasks && !signal.aborted) {
                launchNextSubTaskIfPossible();
              } else if (currentlyActiveSubTasks === 0) {
                console.info(
                  `[TransfersService] Task ${taskId}: All ${totalSubTasks} sub-tasks have completed or been skipped after processing.`,
                );
                signal.removeEventListener('abort', onAbortOverall);
                resolveAllTasksCompleted();
              }
            });
            subTaskExecutionPromises.push(taskPromise);
          }
          if (currentSubTaskIndex === totalSubTasks && currentlyActiveSubTasks === 0 && !signal.aborted) {
            console.info(`[TransfersService] Task ${taskId}: All sub-tasks processed (no active, no more to launch).`);
            signal.removeEventListener('abort', onAbortOverall);
            resolveAllTasksCompleted();
          }
        };

        if (totalSubTasks === 0) {
          console.info(`[TransfersService] Task ${taskId}: No sub-tasks to process.`);
          signal.removeEventListener('abort', onAbortOverall);
          resolveAllTasksCompleted();
          return;
        }
        if (signal.aborted) {
          // Check if cancelled even before starting the loop
          console.info(`[TransfersService] Task ${taskId}: Cancelled before sub-task loop initiation.`);
          task.subTasks.forEach((st) => {
            // Mark all sub-tasks as cancelled
            if (st.status !== 'completed' && st.status !== 'failed')
              this.updateSubTaskStatus(
                taskId,
                st.subTaskId,
                'cancelled',
                undefined,
                'Task cancelled before sub-task execution.',
              );
          });
          signal.removeEventListener('abort', onAbortOverall);
          rejectAllTasksCompleted(new DOMException('Transfer cancelled by user.', 'AbortError'));
          return;
        }
        launchNextSubTaskIfPossible();
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.info(`[TransfersService] Task ${taskId} processing was aborted.`);
        this.updateOverallTaskStatus(taskId, 'cancelled', 'Transfer cancelled by user.');
      } else {
        console.error(`[TransfersService] Major error processing task ${taskId}:`, error);
        this.updateOverallTaskStatus(taskId, 'failed', error.message || 'Failed to process task due to a major error.');
      }
    } finally {
      if (sourceSshClient) {
        // 直接检查 sourceSshClient 是否存在
        try {
          sourceSshClient.end();
          console.info(`[TransfersService] SSH connection to source server explicitly closed for task ${taskId}.`);
        } catch (e) {
          console.warn(`[TransfersService] Error ending sourceSshClient for task ${taskId}:`, e);
        }
      }
      this.finalizeOverallTaskStatus(taskId); // Ensure final status is set
      this.taskAbortControllers.delete(taskId);
      if (task) {
        // task 可能未定义如果 taskId 错误
        console.info(`[TransfersService] Task ${taskId} processing finished. Final status: ${task.status}.`);
      } else {
        console.info(`[TransfersService] Task ${taskId} processing finished (task object was not found at the end).`);
      }
    }
  }

  private async checkCommandOnSource(client: Client, command: string): Promise<string | null> {
    const checkCmd = `command -v ${this.escapeShellArg(command)} 2>/dev/null`;
    try {
      const result = await executeSshCommand(client, { command: checkCmd, timeoutMs: 10_000, maxOutputBytes: 16 * 1024 });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async checkCommandOnTargetServer(
    targetConnection: ResolvedSshConnection,
    command: string,
  ): Promise<string | null> {
    let targetClient: Client | undefined;
    let foundCommandPath: string | null = null;

    try {
      targetClient = await sshConnectionFactory.connect(targetConnection);
      const checkCmd = `command -v ${this.escapeShellArg(command)} 2>/dev/null`;
      const result = await executeSshCommand(targetClient, {
        command: checkCmd,
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
      });
      foundCommandPath = result.stdout.trim() || null;
    } catch (error) {
      foundCommandPath = null; // Ensure it's null on error
    } finally {
      targetClient?.end();
    }
    return foundCommandPath;
  }

  private async uploadKeyToSourceViaSftp(client: Client, privateKeyContent: string, remotePath: string): Promise<void> {
    const SFTP_UPLOAD_TIMEOUT_MS = 30000; // 30 seconds timeout for SFTP key upload

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let sftpSession: SFTPWrapper | null = null; // To ensure sftp.end() can be called in timeout

      const cleanupAndReject = (errMsg: string, errObj?: any) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        sftpSession?.end();
        reject(new Error(errMsg));
      };

      timeoutHandle = setTimeout(() => {
        cleanupAndReject(`SFTP upload to ${remotePath} timed out after ${SFTP_UPLOAD_TIMEOUT_MS / 1000}s.`);
      }, SFTP_UPLOAD_TIMEOUT_MS);

      client.sftp((err, sftp) => {
        sftpSession = sftp; // Store session for potential cleanup
        if (err) {
          return cleanupAndReject(`SFTP session error for key upload: ${err.message}`, err);
        }
        if (!sftp) {
          return cleanupAndReject(`SFTP session error: SFTP object is null.`);
        }
        const stream = sftp.createWriteStream(remotePath, { mode: 0o600 });

        stream.on('error', (writeErr: Error) => {
          cleanupAndReject(`Failed to write key to ${remotePath} on source: ${writeErr.message}`, writeErr);
        });

        // Listen to 'close' instead of 'finish' for more reliability
        stream.on('close', () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          console.info(`[TransfersService] Private key for target successfully uploaded to source at ${remotePath}`);
          sftp.end();
          resolve();
        });

        let keyContentToWrite = privateKeyContent;
        if (!keyContentToWrite.endsWith('\n')) {
          keyContentToWrite += '\n';
        }
        stream.end(keyContentToWrite);
      });
    });
  }

  private async deleteFileOnSourceViaSftp(client: Client, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(new Error(`SFTP session error for key deletion: ${err.message}`));
        sftp.unlink(remotePath, (unlinkErr) => {
          sftp.end(); // Ensure sftp session is closed
          if (unlinkErr) {
            // Log but don't necessarily reject if file just wasn't there (though it should be)
            console.warn(`[TransfersService] Failed to delete temporary key ${remotePath} from source:`, unlinkErr);
            return reject(new Error(`Failed to delete ${remotePath} from source: ${unlinkErr.message}`));
          }
          console.info(`[TransfersService] Temporary key ${remotePath} deleted from source.`);
          resolve();
        });
      });
    });
  }

  private escapeShellArg(arg: string): string {
    return quotePosixShellArg(arg);
  }

  private buildTransferCommandString(
    sourceItemPathOnA: string, // Absolute path on source A
    isDir: boolean,
    targetPathOnB: string, // Base remote target path on B
    executableCommand: string, // Full path to rsync or scp
    commandType: 'rsync' | 'scp', // To distinguish logic
    options: {
      // Options derived from checking source A and target B auth
      sshPassCommand?: string; // e.g., "sshpass -p 'password'"
      sshIdentityFileOption?: string; // e.g., "-i /tmp/key_B_XYZ"
      targetUserAndHost: string; // e.g., "userB@hostB.com"
      sshPortOption?: string; // e.g., "-P 2222" for scp, or part of rsync's -e 'ssh -p 2222'
    },
  ): string {
    const remoteBase = targetPathOnB.endsWith('/') ? targetPathOnB : `${targetPathOnB}/`;
    const remoteFullDest = this.escapeShellArg(`${options.targetUserAndHost}:${remoteBase}`);

    let commandParts: string[] = [];
    if (options.sshPassCommand) {
      commandParts.push(options.sshPassCommand);
    }

    commandParts.push(this.escapeShellArg(executableCommand));

    if (commandType === 'rsync') {
      commandParts.push('-avz --progress'); // rsync specific options
      // For rsync, SSH options go into the -e argument
      let sshArgsForRsync = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      if (options.sshPortOption && options.sshPortOption.startsWith('-p')) {
        // rsync uses -p for port in its -e "ssh -p XXX"
        sshArgsForRsync += ` ${options.sshPortOption}`;
      }
      if (options.sshIdentityFileOption) {
        // -i for identity file is an ssh option
        sshArgsForRsync += ` ${options.sshIdentityFileOption}`;
      }
      commandParts.push(`-e "${sshArgsForRsync.trim()}"`);

      let rsyncSourcePath = this.escapeShellArg(sourceItemPathOnA);
      if (isDir && !rsyncSourcePath.endsWith("/'")) {
        rsyncSourcePath = rsyncSourcePath.slice(0, -1) + "/'";
      }
      commandParts.push(rsyncSourcePath);
      commandParts.push(remoteFullDest);
    } else {
      // scp
      commandParts.push('-o StrictHostKeyChecking=no'); // For scp, pass as direct option
      commandParts.push('-o UserKnownHostsFile=/dev/null'); // For scp, pass as direct option
      if (isDir) commandParts.push('-r');
      if (options.sshPortOption && options.sshPortOption.startsWith('-P')) {
        // scp uses -P for port
        commandParts.push(options.sshPortOption);
      }
      if (options.sshIdentityFileOption) {
        // scp uses -i for identity file
        commandParts.push(options.sshIdentityFileOption);
      }
      commandParts.push(this.escapeShellArg(sourceItemPathOnA));
      commandParts.push(remoteFullDest);
    }
    return commandParts.join(' ');
  }

  private async executeRemoteTransferOnSource(
    taskId: string,
    subTaskId: string,
    sourceSshClient: Client,
    sourceItem: { name: string; path: string; type: 'file' | 'directory' },
    targetConnection: ResolvedSshConnection,
    remoteTargetPathOnTarget: string,
    transferMethodPreference: 'auto' | 'rsync' | 'scp',
    signal: AbortSignal, // +++ Add AbortSignal parameter +++
  ): Promise<void> {
    if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
    this.updateSubTaskStatus(
      taskId,
      subTaskId,
      'transferring',
      0,
      `Initializing remote transfer for ${sourceItem.name}`,
    );
    let tempTargetKeyPathOnSource: string | undefined;

    try {
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      // Pass signal to these check commands if they are made to support it. For now, they are quick.
      const sshpassPath = await this.checkCommandOnSource(sourceSshClient, 'sshpass' /*, signal */);
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      const rsyncPathOnSource = await this.checkCommandOnSource(sourceSshClient, 'rsync' /*, signal */);
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      const scpPathOnSource = await this.checkCommandOnSource(sourceSshClient, 'scp' /*, signal */);
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      let executableCommandPath: string | null = null;
      let commandTypeForLogic: 'rsync' | 'scp' | undefined = undefined; // Initialize as undefined
      let rsyncPathOnTarget: string | null = null;

      if (transferMethodPreference === 'auto') {
        if (rsyncPathOnSource) {
          // Source has rsync, check target
          rsyncPathOnTarget = await this.checkCommandOnTargetServer(
            targetConnection,
            'rsync' /*, signal */,
          );
          if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
          if (rsyncPathOnTarget) {
            executableCommandPath = rsyncPathOnSource;
            commandTypeForLogic = 'rsync';
          }
        }
        if (!commandTypeForLogic) {
          // If rsync not chosen, try SCP
          if (scpPathOnSource) {
            executableCommandPath = scpPathOnSource;
            commandTypeForLogic = 'scp';
          } else {
            throw new Error(`Neither Rsync nor SCP are available on source for ${sourceItem.name} (auto mode).`);
          }
        }
      } else if (transferMethodPreference === 'rsync') {
        if (!rsyncPathOnSource) throw new Error(`Rsync preferred but not available on source for ${sourceItem.name}.`);
        rsyncPathOnTarget = await this.checkCommandOnTargetServer(
          targetConnection,
          'rsync' /*, signal */,
        );
        if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
        if (!rsyncPathOnTarget) throw new Error(`Rsync preferred, but not available on target for ${sourceItem.name}.`);
        executableCommandPath = rsyncPathOnSource;
        commandTypeForLogic = 'rsync';
      } else if (transferMethodPreference === 'scp') {
        if (!scpPathOnSource) throw new Error(`SCP preferred but not available on source for ${sourceItem.name}.`);
        executableCommandPath = scpPathOnSource;
        commandTypeForLogic = 'scp';
      }

      if (!executableCommandPath || !commandTypeForLogic) {
        throw new Error(`Could not determine a valid transfer command for ${sourceItem.name}.`);
      }
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 5, `Using ${commandTypeForLogic}.`);

      // +++ Declare and initialize cmdOptions here +++
      const targetPort = Number(targetConnection.port);
      if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
        throw new Error(`Invalid target SSH port: ${targetConnection.port}`);
      }

      const cmdOptions: {
        targetUserAndHost: string;
        sshPortOption?: string;
        sshIdentityFileOption?: string;
        sshPassCommand?: string;
      } = {
        targetUserAndHost: `${targetConnection.username}@${targetConnection.host}`,
        sshPortOption: commandTypeForLogic === 'scp' ? `-P ${targetPort}` : `-p ${targetPort}`,
      };
      const subTaskToUpdate = this.transferTasks.get(taskId)?.subTasks.find((st) => st.subTaskId === subTaskId);
      if (subTaskToUpdate) subTaskToUpdate.transferMethodUsed = commandTypeForLogic;

      // +++ 自动创建目标目录 +++
      this.updateSubTaskStatus(
        taskId,
        subTaskId,
        'transferring',
        6,
        `Ensuring target directory ${this.escapeShellArg(remoteTargetPathOnTarget)} exists on ${targetConnection.host}.`,
      );
      let targetClientForMkdir: Client | undefined;
      try {
        if (signal.aborted) throw new DOMException('Transfer cancelled by user (before mkdir).', 'AbortError');
        targetClientForMkdir = await sshConnectionFactory.connect(targetConnection, undefined, signal);
        const mkdirCommand = `mkdir -p ${this.escapeShellArg(remoteTargetPathOnTarget)}`;
        await executeSshCommand(targetClientForMkdir, {
          command: mkdirCommand,
          timeoutMs: 30_000,
          maxOutputBytes: 64 * 1024,
          signal,
        });
        console.info(
          `[TransfersService] Sub-task ${subTaskId}: Target directory ${remoteTargetPathOnTarget} ensured on ${targetConnection.host}.`,
        );
        targetClientForMkdir.end();
        if (signal.aborted) throw new DOMException('Transfer cancelled by user (after mkdir).', 'AbortError');
        this.updateSubTaskStatus(
          taskId,
          subTaskId,
          'transferring',
          8,
          `Target directory ensured. Preparing transfer command.`,
        );
      } catch (mkdirError: any) {
        try { targetClientForMkdir?.end(); } catch { /* best effort */ }
        console.error(
          `[TransfersService] Sub-task ${subTaskId}: Failed to ensure target directory ${remoteTargetPathOnTarget} on ${targetConnection.host}:`,
          mkdirError.message,
        );
        if (mkdirError.name === 'AbortError') {
          this.updateSubTaskStatus(
            taskId,
            subTaskId,
            'cancelled',
            undefined,
            `Directory creation cancelled: ${mkdirError.message}`,
          );
          throw mkdirError;
        }
        this.updateSubTaskStatus(
          taskId,
          subTaskId,
          'failed',
          undefined,
          `Failed to create target directory: ${mkdirError.message}`,
        );
        throw new Error(`Failed to create target directory ${remoteTargetPathOnTarget}: ${mkdirError.message}`); // This will be caught by the outer try-catch
      }
      // +++ 结束自动创建目标目录 +++

      if (targetConnection.authMethod === 'key' && targetConnection.privateKey) {
        const randomSuffix = crypto.randomBytes(6).toString('hex');
        tempTargetKeyPathOnSource = path.posix.join('/tmp', `${this.TEMP_KEY_PREFIX}${randomSuffix}`);
        await this.uploadKeyToSourceViaSftp(
          sourceSshClient,
          targetConnection.privateKey,
          tempTargetKeyPathOnSource,
        );
        if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
        cmdOptions.sshIdentityFileOption = `-i ${this.escapeShellArg(tempTargetKeyPathOnSource)}`;
        if (targetConnection.passphrase && !sshpassPath) {
          throw new Error(`Target key has passphrase, but sshpass is not available on source for ${sourceItem.name}.`);
        }
        if (targetConnection.passphrase && sshpassPath) {
          cmdOptions.sshPassCommand = `${this.escapeShellArg(sshpassPath)} -p ${this.escapeShellArg(targetConnection.passphrase)}`;
        }
      } else if (targetConnection.authMethod === 'password' && targetConnection.password) {
        if (!sshpassPath) {
          throw new Error(`Target uses password auth, but sshpass is not available on source for ${sourceItem.name}.`);
        }
        cmdOptions.sshPassCommand = `${this.escapeShellArg(sshpassPath)} -p ${this.escapeShellArg(targetConnection.password)}`;
      } else if (targetConnection.authMethod === 'key' && !targetConnection.privateKey) {
        throw new Error(`Target connection ${targetConnection.name} is key-based but no private key found.`);
      }
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      const commandToExecute = this.buildTransferCommandString(
        sourceItem.path,
        sourceItem.type === 'directory',
        remoteTargetPathOnTarget,
        executableCommandPath,
        commandTypeForLogic,
        cmdOptions,
      );
      this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 10, `Executing: ${commandTypeForLogic}`);

      const commandSessions = new CommandSessionManager(sourceSshClient);
      const execOptions: ExecOptions = {};
      if (cmdOptions.sshPassCommand) execOptions.pty = true;

      try {
        const commandSession = await commandSessions.start({
          id: `transfer:${taskId}:${subTaskId}`,
          command: commandToExecute,
          execOptions,
        });

        if (signal.aborted) {
          await commandSession.terminate();
          throw new DOMException('Command cancelled by user before streaming began.', 'AbortError');
        }

        await new Promise<void>((resolveCmd, rejectCmd) => {
          let settled = false;
          let stderrCombined = '';
          let timeoutHandle: NodeJS.Timeout | undefined;

          const cleanup = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            signal.removeEventListener('abort', onAbortCmd);
          };
          const settle = (error?: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) rejectCmd(error);
            else resolveCmd();
          };
          const onAbortCmd = () => {
            console.warn(
              `[TransfersService] Abort signal received for command session of sub-task ${subTaskId}. Terminating remote command.`,
            );
            void commandSession
              .terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 })
              .finally(() => settle(new DOMException('Command cancelled by user.', 'AbortError')));
          };
          signal.addEventListener('abort', onAbortCmd, { once: true });

          const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
          timeoutHandle = setTimeout(() => {
            void commandSession
              .terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 })
              .finally(() => settle(new Error(`${commandTypeForLogic} command timed out for ${sourceItem.name}.`)));
          }, COMMAND_TIMEOUT_MS);
          timeoutHandle.unref?.();

          commandSession.on('stdout', (data: Buffer) => {
            if (signal.aborted || settled) return;
            if (commandTypeForLogic === 'rsync') {
              const progressMatch = data.toString().match(/(\d+)%/);
              if (progressMatch?.[1]) {
                this.updateSubTaskStatus(taskId, subTaskId, 'transferring', parseInt(progressMatch[1], 10));
              }
            } else {
              this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 50, 'SCP in progress...');
            }
          });
          commandSession.on('stderr', (data: Buffer) => {
            if (!signal.aborted && !settled) stderrCombined += data.toString();
          });
          commandSession.once('close', ({ exitCode }) => {
            if (signal.aborted) {
              settle(new DOMException('Command cancelled by user (on close).', 'AbortError'));
              return;
            }
            if (exitCode === 0) {
              this.updateSubTaskStatus(taskId, subTaskId, 'completed', 100, `${commandTypeForLogic} successful.`);
              settle();
              return;
            }
            settle(new Error(`${commandTypeForLogic} failed. Code: ${exitCode}. Stderr: ${stderrCombined.trim()}`));
          });
          commandSession.once('error', (streamError: Error) => {
            if (signal.aborted) {
              settle(new DOMException('Command stream error due to cancellation.', 'AbortError'));
              return;
            }
            settle(streamError);
          });
        });
      } finally {
        await commandSessions.closeAll();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.info(
          `[TransfersService] executeRemoteTransferOnSource for sub-task ${subTaskId} (item: ${sourceItem.name}) was aborted.`,
        );
        // Status will be updated to 'cancelled' by the caller or here if not already
        const subTaskInstance = this.transferTasks.get(taskId)?.subTasks.find((st) => st.subTaskId === subTaskId);
        if (subTaskInstance && subTaskInstance.status !== 'cancelled') {
          this.updateSubTaskStatus(taskId, subTaskId, 'cancelled', undefined, error.message);
        }
      } else {
        console.error(
          `[TransfersService] executeRemoteTransferOnSource error for sub-task ${subTaskId} (item: ${sourceItem.name}):`,
          error,
        );
        this.updateSubTaskStatus(
          taskId,
          subTaskId,
          'failed',
          undefined,
          error.message || `Remote transfer execution failed for ${sourceItem.name}.`,
        );
      }
      throw error; // Re-throw to be caught by processSingleSubTaskWrapper
    } finally {
      if (tempTargetKeyPathOnSource) {
        try {
          // TODO: Make deleteFileOnSourceViaSftp accept signal
          await this.deleteFileOnSourceViaSftp(sourceSshClient, tempTargetKeyPathOnSource);
        } catch (cleanupError) {
          console.warn(
            `[TransfersService] Failed to cleanup temp key ${tempTargetKeyPathOnSource} on source for sub-task ${subTaskId}:`,
            cleanupError,
          );
        }
      }
    }
  }

  // --- Status Update and Retrieval Methods (largely unchanged) ---
  public async getTransferTaskDetails(taskId: string, userId: string | number): Promise<TransferTask | null> {
    const task = this.transferTasks.get(taskId);
    console.debug(`[TransfersService] Retrieving details for task: ${taskId} for user: ${userId}`);
    if (task && task.userId === userId) {
      // Spread the task, then explicitly add top-level fields from payload
      const taskToReturn = {
        ...task,
        subTasks: task.subTasks.map((st) => ({ ...st })),
        sourceConnectionId: task.payload.sourceConnectionId,
        remoteTargetPath: task.payload.remoteTargetPath,
      };
      return taskToReturn;
    }
    if (task && task.userId !== userId) {
      console.warn(`[TransfersService] User ${userId} attempted to access task ${taskId} owned by ${task.userId}.`);
      return null;
    }
    return null;
  }

  public async getAllTransferTasks(userId: string | number): Promise<TransferTask[]> {
    console.debug(`[TransfersService] Retrieving all transfer tasks for user: ${userId}.`);
    return Array.from(this.transferTasks.values())
      .filter((task) => task.userId === userId)
      .map((task) => {
        // Spread the task, then explicitly add top-level fields from payload
        return {
          ...task,
          subTasks: task.subTasks.map((st) => ({ ...st })),
          sourceConnectionId: task.payload.sourceConnectionId,
          remoteTargetPath: task.payload.remoteTargetPath,
        };
      });
  }

  public updateSubTaskStatus(
    taskId: string,
    subTaskId: string,
    newStatus: TransferSubTask['status'],
    progress?: number,
    message?: string,
  ): void {
    const task = this.transferTasks.get(taskId);
    if (task) {
      const subTask = task.subTasks.find((st) => st.subTaskId === subTaskId);
      if (subTask) {
        const finalSubTaskStatuses: TransferSubTask['status'][] = ['completed', 'failed', 'cancelled'];
        if (finalSubTaskStatuses.includes(subTask.status) && newStatus !== subTask.status) {
          console.warn(
            `[TransfersService] Attempted to update final sub-task ${subTaskId} status '${subTask.status}' to '${newStatus}'. Ignoring.`,
          );
          return;
        }

        subTask.status = newStatus;
        if (progress !== undefined) subTask.progress = Math.min(100, Math.max(0, progress)); // Clamp progress
        if (message !== undefined) subTask.message = message;
        if (['completed', 'failed', 'cancelled'].includes(newStatus) && !subTask.endTime) {
          subTask.endTime = new Date();
        }
        task.updatedAt = new Date();
        this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Important: update overall task
        console.info(
          `[TransfersService] Sub-task ${subTaskId} (task ${taskId}) updated: ${newStatus}, progress: ${subTask.progress}%, msg: "${subTask.message}"`,
        );
      } else {
        console.warn(`[TransfersService] Sub-task ${subTaskId} not found for task ${taskId} during status update.`);
      }
    } else {
      console.warn(`[TransfersService] Task ${taskId} not found during sub-task status update.`);
    }
  }

  private updateOverallTaskStatus(taskId: string, newStatus: TransferTask['status'], message?: string): void {
    const task = this.transferTasks.get(taskId);
    if (task) {
      const isCurrentStatusFinal = this.isFinalTaskStatus(task.status);
      // Check if newStatus is one of the transient states
      const isNewStatusTransient = newStatus === 'queued' || newStatus === 'in-progress';

      if (task.status === 'cancelled' && newStatus !== 'cancelled') {
        console.warn(
          `[TransfersService] Attempted to overwrite cancelled task ${taskId} with '${newStatus}'. Ignoring.`,
        );
        return;
      }
      if (isCurrentStatusFinal && isNewStatusTransient) {
        // If current status is final and new status is transient, ignore the update.
        console.warn(
          `[TransfersService] Attempted to update final task ${taskId} status '${task.status}' to transient '${newStatus}'. Ignoring.`,
        );
        return;
      }

      // Proceed with the update if:
      // 1. Current status is not final.
      // 2. Current status is final, and newStatus is also a final state (e.g., 'partially-completed' to 'failed').
      task.status = newStatus;
      task.updatedAt = new Date();
      // Overall task message could be an aggregation or just the first major error.
      // For simplicity, not adding detailed message aggregation here.
      console.info(
        `[TransfersService] Overall status for task ${taskId} directly updated to: ${newStatus}` +
          (message ? ` (Msg: ${message})` : ''),
      );
    }
  }

  private updateOverallTaskStatusBasedOnSubTasks(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;

    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let inProgressCount = 0;
    let queuedCount = 0;
    let totalProgress = 0;
    const numSubTasks = task.subTasks.length;

    if (numSubTasks === 0) {
      task.overallProgress = 0;
      task.updatedAt = new Date();
      return;
    }

    task.subTasks.forEach((st) => {
      switch (st.status) {
        case 'completed':
          completedCount++;
          totalProgress += 100;
          break;
        case 'failed':
          failedCount++;
          totalProgress += st.progress || 0;
          break;
        case 'cancelled':
          cancelledCount++;
          totalProgress += st.progress || 0;
          break;
        case 'transferring':
        case 'connecting':
        case 'cancelling':
          inProgressCount++;
          totalProgress += st.progress !== undefined ? st.progress : st.status === 'connecting' ? 5 : 0;
          break;
        case 'queued':
          queuedCount++;
          break;
      }
    });

    task.overallProgress = Math.round(totalProgress / numSubTasks);
    const terminalCount = completedCount + failedCount + cancelledCount;
    let newOverallStatus: TransferTask['status'];

    if (task.status === 'cancelled') {
      newOverallStatus = 'cancelled';
    } else if (task.status === 'cancelling' || cancelledCount > 0) {
      newOverallStatus = terminalCount === numSubTasks ? 'cancelled' : 'cancelling';
    } else if (failedCount === numSubTasks) {
      newOverallStatus = 'failed';
    } else if (completedCount === numSubTasks) {
      newOverallStatus = 'completed';
    } else if (failedCount > 0 && completedCount + failedCount === numSubTasks) {
      newOverallStatus = 'partially-completed';
    } else if (inProgressCount > 0 || (queuedCount > 0 && (failedCount > 0 || completedCount > 0))) {
      newOverallStatus = 'in-progress';
    } else if (queuedCount === numSubTasks) {
      newOverallStatus = 'queued';
    } else {
      newOverallStatus = 'in-progress';
    }

    if (task.status !== newOverallStatus) {
      console.info(
        `[TransfersService] Task ${taskId} overall status changing from ${task.status} to ${newOverallStatus} (P: ${task.overallProgress}%)`,
      );
      task.status = newOverallStatus;
    }
    task.updatedAt = new Date();
  }

  private finalizeOverallTaskStatus(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;
    this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Recalculate based on final sub-task states
    console.info(
      `[TransfersService] Finalized overall status for task ${taskId}: ${task.status}, progress: ${task.overallProgress}%`,
    );
  }
}
