export interface UserSummary {
  id: number;
  username: string;
}

export interface UserService {
  get(id: number): Promise<UserSummary | null>;
  count(): Promise<number>;
}
