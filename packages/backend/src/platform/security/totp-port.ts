/** Technology-only TOTP algorithm and presentation contract. */
export interface TotpSetup {
	secret: string;
	qrCodeUrl: string;
}

export interface TotpPort {
	generate(label: string, issuer: string): Promise<TotpSetup>;
	verify(secret: string, code: string, now: number): boolean;
}
