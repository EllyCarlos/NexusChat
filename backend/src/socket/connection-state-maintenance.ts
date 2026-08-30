import type { SocketPresenceTransition } from "./connection-directory.js";

export type OwnedSocketConnection = {
  userId: string;
  socketId: string;
};

export type SocketLeaseRenewal = {
  renewedCount: number;
  missingConnections: OwnedSocketConnection[];
};

export type SocketLeaseReaping = {
  processedCount: number;
  moreExpired: boolean;
  transitions: SocketPresenceTransition[];
};

export type SettledPresenceCleanup = {
  processedCount: number;
  cleanedCount: number;
  moreSettled: boolean;
};

export interface SocketConnectionStateMaintenance {
  renewOwnedLeases(): Promise<SocketLeaseRenewal>;
  reapExpiredLeases(limit?: number): Promise<SocketLeaseReaping>;
  listPendingPresence(limit?: number): Promise<SocketPresenceTransition[]>;
  claimPresence(
    userId: string,
    token: string,
    claimTtlMilliseconds: number,
  ): Promise<SocketPresenceTransition | undefined>;
  getClaimedPresence(
    userId: string,
    token: string,
  ): Promise<SocketPresenceTransition | undefined>;
  completePresence(
    userId: string,
    token: string,
    version: number,
  ): Promise<boolean>;
  releasePresence(userId: string, token: string): Promise<void>;
  cleanupSettledPresence(limit?: number): Promise<SettledPresenceCleanup>;
}
