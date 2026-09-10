import type { SandboxEngine } from './sandbox-engine';
import type { RunnerJournal } from './journal';
import type { PluginRunnerRuntime } from './plugin-runner-runtime';

export class Reconciler {
  constructor(
    private readonly journal: RunnerJournal,
    private readonly sandboxEngine: SandboxEngine,
    private readonly pluginRunner: PluginRunnerRuntime,
  ) {}
  async reconcile(): Promise<void> {
    for (const environment of this.journal.environments()) {
      try {
        const reconciled = await this.sandboxEngine.reconcile(environment);
        this.journal.saveEnvironment(reconciled);
        if (reconciled.status === 'running') await this.pluginRunner.activateEnvironment(reconciled);
      } catch {
        this.journal.saveEnvironment({ ...environment, status: 'failed', updatedAt: Math.floor(Date.now() / 1000) });
      }
    }
    for (const command of this.journal.commands()) {
      if (command.status === 'running') this.journal.unknown(command.commandId, 'controller_restarted_during_command');
    }
    for (const job of this.journal.jobs()) {
      if (job.status === 'running') this.journal.unknownJob(job.jobId, 'controller_restarted_during_job');
    }
  }
}
