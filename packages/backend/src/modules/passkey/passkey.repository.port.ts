import type { PasskeyCredential, PasskeyRegistrationCredential } from './passkey.types';

export interface CreatePasskeyRecord extends PasskeyRegistrationCredential {
  userId: number;
  name?: string | null;
}

export interface PasskeyRepository {
  create(data: CreatePasskeyRecord): Promise<PasskeyCredential>;
  getByCredentialId(credentialId: string): Promise<PasskeyCredential | null>;
  listByUser(userId: number): Promise<PasskeyCredential[]>;
  commitAuthentication(credentialId: string, expectedCounter: number, counter: number): Promise<boolean>;
  delete(credentialId: string): Promise<boolean>;
  updateName(credentialId: string, name: string): Promise<boolean>;
  getFirst(): Promise<PasskeyCredential | null>;
}
