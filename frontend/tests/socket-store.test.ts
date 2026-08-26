import type { Socket } from "socket.io-client";
import { describe, expect, it, vi } from "vitest";
import { createSocketStore } from "@/context/socket.context";

describe("socket context store", () => {
  it("publishes socket lifecycle transitions to subscribers", () => {
    const store = createSocketStore();
    const listener = vi.fn();
    const socket = { id: "socket-1" } as Socket;
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBeNull();

    store.setSocket(socket);
    expect(store.getSnapshot()).toBe(socket);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setSocket(null);
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.setSocket(socket);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify subscribers when the snapshot is unchanged", () => {
    const store = createSocketStore();
    const listener = vi.fn();
    const socket = { id: "socket-1" } as Socket;
    store.subscribe(listener);

    store.setSocket(socket);
    store.setSocket(socket);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
