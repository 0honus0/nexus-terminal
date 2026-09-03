export interface AuthenticatedUser {
  id: number;
  username: string;
}

export interface AuthService {
  authenticatePassword(username: string, password: string): Promise<AuthenticatedUser | null>;
  changePassword(userId: number, currentPassword: string, nextPassword: string): Promise<void>;
}
