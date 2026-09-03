export interface SshKeySummary {
  id: number;
  name: string;
  createdAt: number;
}

export interface SshKeyService {
  list(): Promise<SshKeySummary[]>;
}
