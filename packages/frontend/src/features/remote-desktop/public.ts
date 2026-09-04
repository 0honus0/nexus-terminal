export { default as RemoteDesktopModal } from './components/RemoteDesktopModal.vue';
export { remoteDesktopApi } from './api/remoteDesktopApi';
export type { RemoteDesktopSessionPort } from './ports/remote-desktop-session-port';
export type {
  RemoteDesktopConnection,
  RemoteDesktopDisplay,
  RemoteDesktopProtocol,
  RemoteDesktopSession,
  RemoteDesktopState,
} from './model/remoteDesktop';
