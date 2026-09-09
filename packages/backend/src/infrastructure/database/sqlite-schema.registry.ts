import * as schema from './sqlite-schema';

export interface SqliteTableDefinition {
  name: string;
  sql: string;
}

/** Current base schema. Historical migrations remain responsible for upgrading existing databases. */
export const sqliteTableDefinitions: readonly SqliteTableDefinition[] = [
  { name: 'settings', sql: schema.createSettingsTableSQL },
  { name: 'settings_migrations', sql: schema.createSettingsMigrationsTableSQL },
  { name: 'audit_logs', sql: schema.createAuditLogsTableSQL },
  { name: 'notification_settings', sql: schema.createNotificationSettingsTableSQL },
  { name: 'users', sql: schema.createUsersTableSQL },
  { name: 'passkeys', sql: schema.createPasskeysTableSQL },
  { name: 'proxies', sql: schema.createProxiesTableSQL },
  { name: 'ssh_keys', sql: schema.createSshKeysTableSQL },
  { name: 'connections', sql: schema.createConnectionsTableSQL },
  { name: 'tags', sql: schema.createTagsTableSQL },
  { name: 'connection_tags', sql: schema.createConnectionTagsTableSQL },
  { name: 'ip_blacklist', sql: schema.createIpBlacklistTableSQL },
  { name: 'command_history', sql: schema.createCommandHistoryTableSQL },
  { name: 'path_history', sql: schema.createPathHistoryTableSQL },
  { name: 'quick_commands', sql: schema.createQuickCommandsTableSQL },
  { name: 'quick_command_tags', sql: schema.createQuickCommandTagsTableSQL },
  { name: 'quick_command_tag_associations', sql: schema.createQuickCommandTagAssociationsTableSQL },
  { name: 'favorite_paths', sql: schema.createFavoritePathsTableSQL },
  { name: 'terminal_themes', sql: schema.createTerminalThemesTableSQL },
  { name: 'appearance_settings', sql: schema.createAppearanceSettingsTableSQL },
];
