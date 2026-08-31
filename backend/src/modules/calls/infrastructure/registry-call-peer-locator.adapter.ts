import type { SocketConnectionDirectory } from "../../../socket/connection-directory.js";
import type { CallPeerLocatorPort } from "../contracts/call-peer-locator.port.js";

type LatestSocketDirectory = Pick<SocketConnectionDirectory, "getLatestSocket">;

export const createRegistryCallPeerLocator = (
  directory: LatestSocketDirectory,
): CallPeerLocatorPort => ({
  getLatestSocketId: (userId) => directory.getLatestSocket(userId),
});
