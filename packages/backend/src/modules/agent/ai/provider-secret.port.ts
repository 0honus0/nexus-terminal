export interface ProviderSecretPort {
  withCredential<T>(
    userId: number,
    providerId: string,
    credentialRevision: number,
    use: (credential: string | null) => Promise<T>,
  ): Promise<T>;
}
