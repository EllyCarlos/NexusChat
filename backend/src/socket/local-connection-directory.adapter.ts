import type { SocketConnectionRegistry } from "./connection-registry.js";
import type {
  DirectoryConnectionRegistration,
  DirectoryConnectionRemoval,
  SocketConnectionDirectory,
  SocketPresenceTransition,
} from "./connection-directory.js";

export class LocalSocketConnectionDirectory implements SocketConnectionDirectory {
  private presenceVersion = 0;

  constructor(private readonly registry: SocketConnectionRegistry) {}

  async add(
    userId: string,
    socketId: string,
    maximumConnections?: number,
  ): Promise<DirectoryConnectionRegistration> {
    const registration = maximumConnections === undefined
      ? this.registry.add(userId, socketId)
      : this.registry.add(userId, socketId, maximumConnections);

    if (!registration.firstConnection) {
      return registration;
    }

    return {
      ...registration,
      presenceTransition: this.createPresenceTransition(
        userId,
        socketId,
        "online",
      ),
    };
  }

  async remove(
    userId: string,
    socketId: string,
  ): Promise<DirectoryConnectionRemoval> {
    const removal = this.registry.remove(userId, socketId);

    if (!removal.lastConnection) {
      return removal;
    }

    return {
      ...removal,
      presenceTransition: this.createPresenceTransition(
        userId,
        socketId,
        "offline",
      ),
    };
  }

  async getSockets(userId: string): Promise<string[]> {
    return this.registry.getSockets(userId);
  }

  async getLatestSocket(userId: string): Promise<string | undefined> {
    return this.registry.getLatestSocket(userId);
  }

  async isOnline(userId: string): Promise<boolean> {
    return this.registry.isOnline(userId);
  }

  async connectionCount(userId: string): Promise<number> {
    return this.registry.connectionCount(userId);
  }

  async onlineUserIds(): Promise<string[]> {
    return this.registry.onlineUserIds();
  }

  private createPresenceTransition(
    userId: string,
    sourceSocketId: string,
    state: SocketPresenceTransition["state"],
  ): SocketPresenceTransition {
    return {
      userId,
      state,
      version: ++this.presenceVersion,
      sourceSocketId,
    };
  }
}

export const createLocalSocketConnectionDirectory = (
  registry: SocketConnectionRegistry,
): SocketConnectionDirectory => new LocalSocketConnectionDirectory(registry);
