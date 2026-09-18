/**
 * Internal lease-renewal cadence shared by all live holders of the Agent lease repository.
 * Current lease contracts never use a TTL below 30 seconds, so a 10 second cadence leaves
 * multiple renewal opportunities before expiry. This is infrastructure policy, not a user setting.
 */
export const LEASE_RENEW_INTERVAL_MS = 10_000;
