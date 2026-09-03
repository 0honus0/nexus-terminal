import type { User } from './user.types';
export interface StoredUserRecord extends User {
  hashedPassword: string;
  twoFactorSecret: string | null;
}
export interface UserRepository {
  get(id: number): Promise<StoredUserRecord | null>;
  findByUsername(username: string): Promise<StoredUserRecord | null>;
  count(): Promise<number>;
  create(username: string, hashedPassword: string): Promise<number>;
  updatePassword(id: number, hashedPassword: string): Promise<boolean>;
  updateTwoFactorSecret(id: number, secret: string | null): Promise<boolean>;
}
