export const CONNECTION_TYPES = ['SSH', 'RDP', 'VNC'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];
export const CONNECTION_ROUTES = ['direct', 'proxy', 'jump'] as const;
export type ConnectionRoute = (typeof CONNECTION_ROUTES)[number];
