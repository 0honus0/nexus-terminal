/** Technical opaque bearer generation and hashing; no user/session business state. */
export interface SessionTokens {
	issue(): string;
	digest(token: string): string;
}
