export type PasskeyTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

export interface PasskeyCredential {
  id: number;
  userId: number;
  credentialId: string;
  publicKeyBase64: string;
  counter: number;
  transports: PasskeyTransport[];
  name: string | null;
  backedUp: boolean;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PasskeySummary {
  credentialId: string;
  name: string | null;
  transports: PasskeyTransport[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface PasskeyOptions {
  challenge: string;
}

export interface PasskeyRegistrationCredential {
  credentialId: string;
  publicKeyBase64: string;
  counter: number;
  transports: PasskeyTransport[];
  backedUp: boolean;
}

export interface PasskeyAuthenticationResult {
  verified: boolean;
  newCounter?: number;
}
