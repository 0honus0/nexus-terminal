export const estimateTokens = (value: string): number => Math.max(1, Math.ceil(Buffer.byteLength(value, 'utf8') / 4));
