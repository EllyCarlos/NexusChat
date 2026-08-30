export const SOCKET_OPERATION_DRAIN_TIMEOUT_MS = 10_000;

export interface SocketOperationTracker {
  readonly isAcceptingConnections: boolean;
  track<T>(operation: Promise<T>): Promise<T>;
  beginDrain(): void;
  drain(timeoutMilliseconds?: number): Promise<void>;
}

export const createSocketOperationTracker = (): SocketOperationTracker => {
  const pending = new Set<Promise<unknown>>();
  let acceptingConnections = true;

  const track = <T>(operation: Promise<T>): Promise<T> => {
    let tracked: Promise<T>;
    tracked = operation.finally(() => {
      pending.delete(tracked);
    });
    pending.add(tracked);
    return tracked;
  };

  const awaitPending = async () => {
    while (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
  };

  return Object.freeze({
    get isAcceptingConnections() {
      return acceptingConnections;
    },
    track,
    beginDrain: () => {
      acceptingConnections = false;
    },
    drain: async (
      timeoutMilliseconds = SOCKET_OPERATION_DRAIN_TIMEOUT_MS,
    ) => {
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          awaitPending(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(new Error("Socket operation drain timed out."));
            }, timeoutMilliseconds);
            timeout.unref();
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  });
};
