export interface OfficialAgentPluginSource {
  catalogUrl: string;
  publisherKeyId: string;
  publisherPublicKeyPem: string;
  publisherLabel: string;
  recommendedAppId: string;
  privateHostExceptions: string[];
}

export const DEFAULT_OFFICIAL_AGENT_PLUGIN_SOURCE: OfficialAgentPluginSource = {
  catalogUrl: 'https://github.com/0honus0/nexus-agent-plugins/releases/latest/download/catalog.json',
  publisherKeyId: 'ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0',
  publisherPublicKeyPem:
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAPw+WXiJPcxqiKjxGCRcm3fWwy+JByAKTKX+iE5pKD/E=\n-----END PUBLIC KEY-----\n',
  publisherLabel: 'Nexus first-party plugins',
  recommendedAppId: 'nexus.agent',
  privateHostExceptions: [],
};
