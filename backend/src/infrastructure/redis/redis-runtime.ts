export interface RedisLifecycleClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  close(): Promise<void>;
  destroy(): void;
}

export interface RedisRuntime<Client extends RedisLifecycleClient = RedisLifecycleClient> {
  readonly client: Client;
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<void>;
  close(): Promise<void>;
}

export const createRedisRuntime = <Client extends RedisLifecycleClient>(
  client: Client,
): RedisRuntime<Client> => {
  let connectPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closingOrClosed = false;

  const connect = (): Promise<void> => {
    if (closingOrClosed) {
      return Promise.reject(new Error("Redis runtime is closed."));
    }

    if (connectPromise) {
      return connectPromise;
    }

    if (client.isReady) {
      connectPromise = Promise.resolve();
      return connectPromise;
    }

    try {
      connectPromise = client.connect().then(() => undefined);
    } catch (error) {
      connectPromise = Promise.reject(error);
    }

    return connectPromise;
  };

  const close = (): Promise<void> => {
    closingOrClosed = true;

    if (closePromise) {
      return closePromise;
    }

    closePromise = (async () => {
      if (client.isOpen) {
        await client.close();
        return;
      }

      client.destroy();
    })();

    return closePromise;
  };

  return Object.freeze({
    client,
    get isOpen() {
      return client.isOpen;
    },
    get isReady() {
      return client.isReady;
    },
    connect,
    close,
  });
};
