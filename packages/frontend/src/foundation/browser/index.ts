export { isMobileUserAgent, useDeviceCapabilities } from './useDeviceCapabilities';
export type { DeviceCapabilities } from './useDeviceCapabilities';
export { writeClipboardText } from './clipboard';
export {
  booleanStorageCodec,
  browserStorageKey,
  jsonStorageCodec,
  numberStorageCodec,
  readStoredValue,
  removeLegacyStorageKeys,
  removeStoredValue,
  stringStorageCodec,
  writeStoredValue,
} from './storage';
export type { BrowserStorageArea, BrowserStorageCodec, BrowserStorageDefinition, BrowserStorageScope } from './storage';
