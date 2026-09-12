import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import type { RunnerJournal } from './journal';
import type { PluginRunnerRuntime } from './plugin-runner-runtime';
import { runnerLog } from '../logging';

export class Reconciler {
  constructor(
    private readonly journal: RunnerJournal,
    private readonly runtimeEngine: WorkspaceRuntimeEngine,
    private readonly pluginRunner: PluginRunnerRuntime,
  ) {}
  async reconcile(): Promise<void> {
    const workspaces = this.journal.workspaces();
    const commands = this.journal.commands();
    const jobs = this.journal.jobs();
    let failedWorkspaces = 0;
    let interruptedCommands = 0;
    let interruptedJobs = 0;
    runnerLog('info', 'Agent Runner startup reconciliation started', {
      workspaceCount: workspaces.length,
      commandCount: commands.length,
      jobCount: jobs.length,
    });
    for (const workspace of workspaces) {
      try {
        const reconciled = await this.runtimeEngine.reconcile(workspace);
        this.journal.saveWorkspace(reconciled);
        if (reconciled.status === 'running') await this.pluginRunner.activateWorkspace(reconciled);
      } catch (error) {
        failedWorkspaces += 1;
        runnerLog('warn', 'Agent Runner Workspace reconciliation failed', {
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          errorCode: error instanceof Error ? error.message : String(error),
        });
        this.journal.saveWorkspace({ ...workspace, status: 'failed' });
      }
    }
    for (const command of commands) {
      if (command.status === 'running') {
        interruptedCommands += 1;
        this.journal.unknown(command.commandId, 'controller_restarted_during_command');
      }
    }
    for (const job of jobs) {
      if (job.status === 'running') {
        interruptedJobs += 1;
        this.journal.unknownJob(job.jobId, 'controller_restarted_during_job');
      }
    }
    this.journal.compact();
    runnerLog('info', 'Agent Runner startup reconciliation finished', {
      workspaceCount: workspaces.length,
      failedWorkspaceCount: failedWorkspaces,
      interruptedCommandCount: interruptedCommands,
      interruptedJobCount: interruptedJobs,
    });
  }
}
