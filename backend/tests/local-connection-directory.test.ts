import { describe, expect, it } from "vitest";

import {
  MAX_CONNECTIONS_PER_USER,
  SocketConnectionRegistry,
} from "../src/socket/connection-registry.js";
import {
  LocalSocketConnectionDirectory,
} from "../src/socket/local-connection-directory.adapter.js";

const USER_A = "local-directory-user-a";
const USER_B = "local-directory-user-b";

const createDirectory = () => new LocalSocketConnectionDirectory(
  new SocketConnectionRegistry(),
);

describe("local Socket connection directory", () => {
  it("wraps the existing registry in an asynchronous boundary", async () => {
    const directory = createDirectory();
    const registration = directory.add(USER_A, "socket-a");

    expect(registration).toBeInstanceOf(Promise);
    await expect(registration).resolves.toMatchObject({
      accepted: true,
      firstConnection: true,
    });
    expect(directory.getSockets(USER_A)).toBeInstanceOf(Promise);
    await expect(directory.getSockets(USER_A)).resolves.toEqual(["socket-a"]);
  });

  it("preserves the exact cap, duplicate, count, and latest-socket semantics", async () => {
    const directory = createDirectory();

    const first = await directory.add(USER_A, "socket-1");
    expect(first).toEqual({
      accepted: true,
      firstConnection: true,
      presenceTransition: {
        userId: USER_A,
        state: "online",
        version: 1,
        sourceSocketId: "socket-1",
      },
    });

    for (let index = 2; index <= MAX_CONNECTIONS_PER_USER; index += 1) {
      await expect(directory.add(USER_A, `socket-${index}`)).resolves.toEqual({
        accepted: true,
        firstConnection: false,
      });
    }

    await expect(directory.getSockets(USER_A)).resolves.toEqual([
      "socket-1",
      "socket-2",
      "socket-3",
      "socket-4",
      "socket-5",
      "socket-6",
      "socket-7",
      "socket-8",
    ]);
    await expect(directory.connectionCount(USER_A)).resolves.toBe(8);
    await expect(directory.getLatestSocket(USER_A)).resolves.toBe("socket-8");

    await expect(directory.add(USER_A, "socket-1")).resolves.toEqual({
      accepted: true,
      firstConnection: false,
    });
    await expect(directory.connectionCount(USER_A)).resolves.toBe(8);
    await expect(directory.getLatestSocket(USER_A)).resolves.toBe("socket-8");

    await expect(directory.add(USER_A, "socket-9")).resolves.toEqual({
      accepted: false,
      firstConnection: false,
    });
    await expect(directory.connectionCount(USER_A)).resolves.toBe(8);
    await expect(directory.getLatestSocket(USER_A)).resolves.toBe("socket-8");
  });

  it("preserves exact unknown, non-final, and final removal results", async () => {
    const directory = createDirectory();
    await directory.add(USER_A, "socket-old");
    await directory.add(USER_A, "socket-latest");

    await expect(directory.remove(USER_A, "socket-unknown")).resolves.toEqual({
      removed: false,
      lastConnection: false,
    });
    await expect(directory.remove(USER_A, "socket-old")).resolves.toEqual({
      removed: true,
      lastConnection: false,
    });
    await expect(directory.remove(USER_A, "socket-latest")).resolves.toEqual({
      removed: true,
      lastConnection: true,
      presenceTransition: {
        userId: USER_A,
        state: "offline",
        version: 2,
        sourceSocketId: "socket-latest",
      },
    });
    await expect(directory.remove(USER_A, "socket-latest")).resolves.toEqual({
      removed: false,
      lastConnection: false,
    });
    await expect(directory.isOnline(USER_A)).resolves.toBe(false);
  });

  it("falls back to the older socket and makes a removed-and-re-added socket newest", async () => {
    const directory = createDirectory();
    await directory.add(USER_A, "socket-old");
    await directory.add(USER_A, "socket-latest");

    await directory.remove(USER_A, "socket-latest");
    await expect(directory.getLatestSocket(USER_A)).resolves.toBe("socket-old");

    await expect(directory.add(USER_A, "socket-latest")).resolves.toEqual({
      accepted: true,
      firstConnection: false,
    });
    await expect(directory.getSockets(USER_A)).resolves.toEqual([
      "socket-old",
      "socket-latest",
    ]);
    await expect(directory.getLatestSocket(USER_A)).resolves.toBe("socket-latest");
  });

  it("preserves global online insertion order and versions later re-online transitions", async () => {
    const directory = createDirectory();

    await expect(directory.add(USER_A, "socket-a-1")).resolves.toMatchObject({
      presenceTransition: { version: 1, state: "online" },
    });
    await expect(directory.add(USER_B, "socket-b-1")).resolves.toMatchObject({
      presenceTransition: { version: 2, state: "online" },
    });
    await directory.add(USER_A, "socket-a-2");
    await expect(directory.onlineUserIds()).resolves.toEqual([USER_A, USER_B]);

    await directory.remove(USER_A, "socket-a-1");
    await expect(directory.onlineUserIds()).resolves.toEqual([USER_A, USER_B]);
    await expect(directory.remove(USER_A, "socket-a-2")).resolves.toMatchObject({
      presenceTransition: { version: 3, state: "offline" },
    });
    await expect(directory.onlineUserIds()).resolves.toEqual([USER_B]);

    await expect(directory.add(USER_A, "socket-a-3")).resolves.toMatchObject({
      presenceTransition: {
        userId: USER_A,
        state: "online",
        version: 4,
        sourceSocketId: "socket-a-3",
      },
    });
    await expect(directory.onlineUserIds()).resolves.toEqual([USER_B, USER_A]);
  });

  it("passes an explicit maximum through without changing another user's state", async () => {
    const directory = createDirectory();

    await expect(directory.add(USER_A, "socket-a-1", 1)).resolves.toMatchObject({
      accepted: true,
      firstConnection: true,
    });
    await expect(directory.add(USER_A, "socket-a-2", 1)).resolves.toEqual({
      accepted: false,
      firstConnection: false,
    });
    await expect(directory.add(USER_B, "socket-b-1", 1)).resolves.toMatchObject({
      accepted: true,
      firstConnection: true,
    });
    await expect(directory.connectionCount(USER_A)).resolves.toBe(1);
    await expect(directory.connectionCount(USER_B)).resolves.toBe(1);
  });
});
