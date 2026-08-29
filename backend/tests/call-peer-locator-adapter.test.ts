import { describe, expect, it, vi } from "vitest";

import { createRegistryCallPeerLocator } from "../src/modules/calls/infrastructure/registry-call-peer-locator.adapter.js";

const USER_ID = "peer-user";

describe("Registry call peer-locator adapter", () => {
  it("delegates the exact user ID to the registry latest-socket lookup", () => {
    const getLatestSocket = vi.fn().mockReturnValue("latest-socket");
    const getSockets = vi.fn().mockReturnValue(["older-socket", "latest-socket"]);
    const registry = {
      getLatestSocket,
      getSockets,
    };
    const locator = createRegistryCallPeerLocator(registry);

    expect(locator.getLatestSocketId(USER_ID)).toBe("latest-socket");
    expect(getLatestSocket).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledWith(USER_ID);
    expect(getSockets).not.toHaveBeenCalled();
  });

  it("preserves an undefined latest-socket result", () => {
    const getLatestSocket = vi.fn().mockReturnValue(undefined);
    const locator = createRegistryCallPeerLocator({ getLatestSocket });

    expect(locator.getLatestSocketId(USER_ID)).toBeUndefined();
    expect(getLatestSocket).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledWith(USER_ID);
  });

  it("passes registry lookup failures through unchanged", () => {
    const failure = new Error("registry lookup failed");
    const getLatestSocket = vi.fn(() => {
      throw failure;
    });
    const locator = createRegistryCallPeerLocator({ getLatestSocket });

    expect(() => locator.getLatestSocketId(USER_ID)).toThrow(failure);
    expect(getLatestSocket).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledWith(USER_ID);
  });
});
