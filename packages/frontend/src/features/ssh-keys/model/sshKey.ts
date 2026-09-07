export interface SshKeySummary {
  id: number;
  name: string;
}
export interface SshKeyDetails extends SshKeySummary {
  privateKey: string;
  passphrase?: string;
}
export interface SshKeyInput {
  name: string;
  privateKey?: string;
  passphrase?: string | null;
}
