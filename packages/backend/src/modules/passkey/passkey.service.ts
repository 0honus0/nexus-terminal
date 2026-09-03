export interface PasskeySummary {
  credentialId: string;
  name: string;
  createdAt: number;
}

export interface PasskeyService {
  list(userId: number): Promise<PasskeySummary[]>;
  remove(userId: number, credentialId: string): Promise<boolean>;
}
