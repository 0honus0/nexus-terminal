export class WorkerGateway {
  readonly environmentId = process.env.NEXUS_ENVIRONMENT_ID ?? '';
  readonly generation = Number(process.env.NEXUS_ENVIRONMENT_GENERATION ?? '0');
  snapshot() {
    return { environmentId: this.environmentId, generation: this.generation, pid: process.pid, ready: true };
  }
}
