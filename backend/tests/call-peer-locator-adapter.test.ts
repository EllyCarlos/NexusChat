import { describe, expect, it, vi } from "vitest";

import { createRegistryCallPeerLocator } from "../src/modules/calls/infrastructure/registry-call-peer-locator.adapter.js";

const USER_ID = "peer-user";

describe("Registry call peer-locator adapter", () => {
  it("delegates the exact user ID to the async directory latest-socket lookup", async () => {
    const getLatestSocket = vi.fn().mockResolvedValue("latest-socket");
    const getSockets = vi.fn().mockResolvedValue(["older-socket", "latest-socket"]);
    const directory = {
      getLatestSocket,
      getSockets,
    };
    const locator = createRegistryCallPeerLocator(directory);

    await expect(locator.getLatestSocketId(USER_ID)).resolves.toBe("latest-socket");
    expect(getLatestSocket).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledWith(USER_ID);
    expect(getSockets).not.toHaveBeenCalled();
  });

  it("preserves an undefined latest-socket result", async () => {
    const getLatestSocket = vi.fn().mockResolvedValue(undefined);
    const locator = createRegistryCallPeerLocator({ getLatestSocket });

    await expect(locator.getLatestSocketId(USER_ID)).resolves.toBeUndefined();
    expect(getLatestSocket).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledWith(USER_ID);
  });

  it("passes directory lookup failures through unchanged", async () => {
    const failure = new Error("directory lookup failed");
    const getLatestSocket = vi.fn().mockRejectedValue(failure);
    const locator = createRegistryCallPeerLocator({ getLatestSocket });

    await expect(locator.getLatestSocketId(USER_ID)).rejects.toBe(failure);
    expect(getLatestSocket).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledWith(USER_ID);
  });
});
