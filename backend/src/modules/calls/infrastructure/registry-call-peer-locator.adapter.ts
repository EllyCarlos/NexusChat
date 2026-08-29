import type { CallPeerLocatorPort } from "../contracts/call-peer-locator.port.js";

type LatestSocketRegistry = {
  getLatestSocket(userId: string): string | undefined;
};

export const createRegistryCallPeerLocator = (
  registry: LatestSocketRegistry,
): CallPeerLocatorPort => ({
  getLatestSocketId: (userId) => registry.getLatestSocket(userId),
});
