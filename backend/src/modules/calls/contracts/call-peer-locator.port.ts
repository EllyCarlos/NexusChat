export interface CallPeerLocatorPort {
  getLatestSocketId(userId: string): string | undefined;
}
