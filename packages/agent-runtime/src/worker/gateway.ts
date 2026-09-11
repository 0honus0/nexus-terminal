export class WorkerGateway {
  readonly workspaceId = process.env.NEXUS_WORKSPACE_ID ?? '';
  readonly generation = Number(process.env.NEXUS_WORKSPACE_GENERATION ?? '0');
  snapshot() {
    return { workspaceId: this.workspaceId, generation: this.generation, pid: process.pid, ready: true };
  }
}
