export interface CallPeerLocatorPort {
  getLatestSocketId(userId: string): Promise<string | undefined>;
}
