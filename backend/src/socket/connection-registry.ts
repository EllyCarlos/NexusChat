export const MAX_CONNECTIONS_PER_USER = 8;

export type ConnectionRegistration = {
  accepted: boolean;
  firstConnection: boolean;
};

export type ConnectionRemoval = {
  removed: boolean;
  lastConnection: boolean;
};

/**
 * Process-local Socket.IO connection state. A distributed deployment will need
 * a shared adapter/registry before presence and connection caps are global.
 */
export class SocketConnectionRegistry {
  private readonly socketsByUser = new Map<string, Map<string, number>>();
  private sequence = 0;

  add(
    userId: string,
    socketId: string,
    maximumConnections = MAX_CONNECTIONS_PER_USER,
  ): ConnectionRegistration {
    const existingSockets = this.socketsByUser.get(userId);
    if (existingSockets?.has(socketId)) {
      return { accepted: true, firstConnection: false };
    }

    if ((existingSockets?.size ?? 0) >= maximumConnections) {
      return { accepted: false, firstConnection: false };
    }

    const sockets = existingSockets ?? new Map<string, number>();
    const firstConnection = sockets.size === 0;
    sockets.set(socketId, ++this.sequence);
    this.socketsByUser.set(userId, sockets);

    return { accepted: true, firstConnection };
  }

  remove(userId: string, socketId: string): ConnectionRemoval {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets?.delete(socketId)) {
      return { removed: false, lastConnection: false };
    }

    if (sockets.size > 0) {
      return { removed: true, lastConnection: false };
    }

    this.socketsByUser.delete(userId);
    return { removed: true, lastConnection: true };
  }

  getSockets(userId: string): string[] {
    return [...(this.socketsByUser.get(userId)?.keys() ?? [])];
  }

  getLatestSocket(userId: string): string | undefined {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return undefined;

    let latestSocketId: string | undefined;
    let latestSequence = Number.NEGATIVE_INFINITY;
    for (const [socketId, sequence] of sockets) {
      if (sequence > latestSequence) {
        latestSocketId = socketId;
        latestSequence = sequence;
      }
    }
    return latestSocketId;
  }

  isOnline(userId: string): boolean {
    return this.connectionCount(userId) > 0;
  }

  connectionCount(userId: string): number {
    return this.socketsByUser.get(userId)?.size ?? 0;
  }

  onlineUserIds(): string[] {
    return [...this.socketsByUser.keys()];
  }

  clear(): void {
    this.socketsByUser.clear();
    this.sequence = 0;
  }
}

export const socketConnectionRegistry = new SocketConnectionRegistry();

/** Serializes DB presence transitions per user without storing request data. */
export class SocketPresenceWriteQueue {
  private readonly pendingByUser = new Map<string, Promise<unknown>>();

  async run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pendingByUser.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.pendingByUser.set(userId, current);

    try {
      return await current;
    } finally {
      if (this.pendingByUser.get(userId) === current) {
        this.pendingByUser.delete(userId);
      }
    }
  }

  clear(): void {
    this.pendingByUser.clear();
  }
}

export const socketPresenceWriteQueue = new SocketPresenceWriteQueue();
