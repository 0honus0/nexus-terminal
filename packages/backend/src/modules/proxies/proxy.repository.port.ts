import type { ProxyAuthMethod, ProxyType } from './proxy.types';

export interface StoredProxyRecord {
  id: number;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  authMethod: ProxyAuthMethod;
  encryptedPassword: string | null;
  encryptedPrivateKey: string | null;
  encryptedPassphrase: string | null;
  createdAt: number;
  updatedAt: number;
}

export type CreateStoredProxyRecord = Omit<StoredProxyRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateStoredProxyRecord = Partial<Omit<StoredProxyRecord, 'id' | 'createdAt' | 'updatedAt'>>;

export interface ProxyRepository {
  list(): Promise<StoredProxyRecord[]>;
  get(id: number): Promise<StoredProxyRecord | null>;
  findDuplicate(name: string, type: ProxyType, host: string, port: number): Promise<{ id: number } | null>;
  create(data: CreateStoredProxyRecord): Promise<number>;
  update(id: number, data: UpdateStoredProxyRecord): Promise<boolean>;
  delete(id: number): Promise<boolean>;
}
