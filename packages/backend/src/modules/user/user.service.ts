import type { UserRepository } from './user.repository.port';
import type { User } from './user.types';
const publicUser = (u: Awaited<ReturnType<UserRepository['get']>>): User | null =>
  u
    ? { id: u.id, username: u.username, hasTwoFactor: u.hasTwoFactor, createdAt: u.createdAt, updatedAt: u.updatedAt }
    : null;
export class UserService {
  constructor(private readonly repository: UserRepository) {}
  async get(id: number) {
    return publicUser(await this.repository.get(id));
  }
  getStored(id: number) {
    return this.repository.get(id);
  }
  findStoredByUsername(username: string) {
    return this.repository.findByUsername(username);
  }
  count() {
    return this.repository.count();
  }
  create(username: string, hashedPassword: string) {
    return this.repository.create(username, hashedPassword);
  }
  updatePassword(id: number, hash: string) {
    return this.repository.updatePassword(id, hash);
  }
  updateTwoFactorSecret(id: number, secret: string | null) {
    return this.repository.updateTwoFactorSecret(id, secret);
  }
}
