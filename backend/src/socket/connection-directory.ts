import type {
  ConnectionRegistration,
  ConnectionRemoval,
} from "./connection-registry.js";

export type SocketPresenceTransition = {
  userId: string;
  state: "online" | "offline";
  version: number;
  sourceSocketId: string;
};

export type DirectoryConnectionRegistration = ConnectionRegistration & {
  presenceTransition?: SocketPresenceTransition;
};

export type DirectoryConnectionRemoval = ConnectionRemoval & {
  presenceTransition?: SocketPresenceTransition;
};

/**
 * Provider-neutral asynchronous user/socket state boundary.
 *
 * The asynchronous shape supports both the existing process-local registry
 * and a distributed implementation without exposing provider-specific types.
 */
export interface SocketConnectionDirectory {
  add(
    userId: string,
    socketId: string,
    maximumConnections?: number,
  ): Promise<DirectoryConnectionRegistration>;

  remove(
    userId: string,
    socketId: string,
  ): Promise<DirectoryConnectionRemoval>;

  getSockets(userId: string): Promise<string[]>;

  getLatestSocket(userId: string): Promise<string | undefined>;

  isOnline(userId: string): Promise<boolean>;

  connectionCount(userId: string): Promise<number>;

  onlineUserIds(): Promise<string[]>;
}
