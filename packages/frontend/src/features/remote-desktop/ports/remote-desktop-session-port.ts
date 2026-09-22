import type {
  RemoteDesktopDisplayDto,
  RemoteDesktopProtocolDto,
  RemoteDesktopSessionDto,
} from '../model/remoteDesktop';
export interface RemoteDesktopSessionPort {
  create(
    connectionId: number,
    protocol: RemoteDesktopProtocolDto,
    display: RemoteDesktopDisplayDto,
  ): Promise<RemoteDesktopSessionDto>;
  tunnelUrl(): string;
  tunnelData(session: RemoteDesktopSessionDto, display: RemoteDesktopDisplayDto): string;
}
