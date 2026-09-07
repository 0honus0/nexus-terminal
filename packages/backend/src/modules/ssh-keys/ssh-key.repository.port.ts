export interface StoredSshKeyRecord {
  id: number;
  name: string;
  encryptedPrivateKey: string;
  encryptedPassphrase: string | null;
  createdAt: number;
  updatedAt: number;
}
export type CreateStoredSshKeyRecord = Omit<StoredSshKeyRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateStoredSshKeyRecord = Partial<Omit<StoredSshKeyRecord, 'id' | 'createdAt' | 'updatedAt'>>;
export interface SshKeyRepository {
  create(data: CreateStoredSshKeyRecord): Promise<number>;
  get(id: number): Promise<StoredSshKeyRecord | null>;
  list(): Promise<StoredSshKeyRecord[]>;
  update(id: number, data: UpdateStoredSshKeyRecord): Promise<boolean>;
  delete(id: number): Promise<boolean>;
}
