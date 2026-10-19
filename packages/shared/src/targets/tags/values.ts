/** Raw request cardinality, before duplicate connection IDs are merged. */
export const TARGET_TAG_CONNECTION_MAX_ITEMS = 1000;

/** Complete JSON budget; includes 1000 maximum safe integer IDs and the envelope. */
export const TARGET_TAG_CONNECTION_BODY_MAX_BYTES = 32 * 1024;

export const TARGET_TAG_NAME_MAX_BYTES = 128;
