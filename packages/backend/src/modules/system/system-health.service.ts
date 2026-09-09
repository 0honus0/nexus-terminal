export interface SystemHealthSnapshot {
  status: 'ok';
  service: 'nexus-backend';
}

export class SystemHealthService {
  get(): SystemHealthSnapshot {
    return { status: 'ok', service: 'nexus-backend' };
  }
}
