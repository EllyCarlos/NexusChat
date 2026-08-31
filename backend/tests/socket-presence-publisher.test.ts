import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";

import type { SocketPresenceTransition } from "../src/socket/connection-directory.js";
import { Events } from "../src/enums/event/event.enum.js";
import { createSocketPresencePublisher } from "../src/socket/socket-presence.publisher.js";

const USER_ID = "presence-user";

const createHarness = () => {
  const excludedEmit = vi.fn();
  const except = vi.fn(() => ({ emit: excludedEmit }));
  const emit = vi.fn();
  const io = { except, emit } as unknown as Server;

  return {
    publisher: createSocketPresencePublisher(io),
    except,
    excludedEmit,
    emit,
  };
};

const transition = (
  state: SocketPresenceTransition["state"],
  sourceSocketId: string,
): SocketPresenceTransition => ({
  userId: USER_ID,
  state,
  version: 37,
  sourceSocketId,
});

describe("Socket presence publisher", () => {
  it("publishes the exact online payload while excluding the source socket", async () => {
    const harness = createHarness();

    await expect(harness.publisher.publishPresence(
      transition("online", "source-socket"),
    )).resolves.toBeUndefined();

    expect(harness.except).toHaveBeenCalledOnce();
    expect(harness.except).toHaveBeenCalledWith("source-socket");
    expect(harness.excludedEmit).toHaveBeenCalledOnce();
    expect(harness.excludedEmit).toHaveBeenCalledWith(
      Events.ONLINE_USER,
      { userId: USER_ID },
    );
    expect(harness.emit).not.toHaveBeenCalled();
  });

  it("publishes the exact offline payload to every socket without a source", async () => {
    const harness = createHarness();

    await expect(harness.publisher.publishPresence(
      transition("offline", ""),
    )).resolves.toBeUndefined();

    expect(harness.except).not.toHaveBeenCalled();
    expect(harness.emit).toHaveBeenCalledOnce();
    expect(harness.emit).toHaveBeenCalledWith(
      Events.OFFLINE_USER,
      { userId: USER_ID },
    );
    expect(harness.excludedEmit).not.toHaveBeenCalled();
  });

  it("propagates a Socket.IO publication failure", async () => {
    const harness = createHarness();
    const failure = new Error("publication failed");
    harness.excludedEmit.mockImplementationOnce(() => { throw failure; });

    await expect(harness.publisher.publishPresence(
      transition("online", "source-socket"),
    )).rejects.toBe(failure);
  });
});
