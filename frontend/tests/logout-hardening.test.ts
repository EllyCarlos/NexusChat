import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClientLogoutCommand,
  performClientLogout,
} from "../src/hooks/useAuth/useLogout";
import { attachmentApi } from "../src/lib/client/rtk-query/attachment.api";
import { authApi } from "../src/lib/client/rtk-query/auth.api";
import { chatApi } from "../src/lib/client/rtk-query/chat.api";
import { friendApi } from "../src/lib/client/rtk-query/friend.api";
import { messageApi } from "../src/lib/client/rtk-query/message.api";
import { requestApi } from "../src/lib/client/rtk-query/request.api";
import { userApi } from "../src/lib/client/rtk-query/user.api";
import {
  resetAuthState,
  setAuthToken,
  updateLoggedInUser,
} from "../src/lib/client/slices/authSlice";
import {
  setIsInCall,
  setMyGlobalStream,
} from "../src/lib/client/slices/callSlice";
import { setChats } from "../src/lib/client/slices/chatSlice";
import {
  setAttachments,
  setDarkMode,
  setRecoverPrivateKeyForm,
  setReplyingToMessageData,
  setSettingsForm,
} from "../src/lib/client/slices/uiSlice";
import { makeStore } from "../src/lib/client/store/store";
import type { FetchUserInfoResponse } from "../src/lib/server/services/userService";

const userFixture = (id: string): FetchUserInfoResponse => ({
  id,
  name: "Test User",
  username: id,
  avatar: "https://example.test/avatar.png",
  email: `${id}@example.test`,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  emailVerified: true,
  publicKey: null,
  needsKeyRecovery: false,
  notificationsEnabled: true,
  verificationBadge: false,
  fcmToken: null,
  oAuthSignup: false,
  isOnline: true,
  lastSeen: null,
});

const createStorage = () => ({ removeItem: vi.fn() });

const populateSensitiveState = (store: ReturnType<typeof makeStore>) => {
  const stop = vi.fn();
  const stream = {
    getTracks: () => [{ stop }],
  } as unknown as MediaStream;

  store.dispatch(updateLoggedInUser(userFixture("user-a")));
  store.dispatch(setAuthToken("session-token"));
  store.dispatch(setDarkMode(true));
  store.dispatch(setRecoverPrivateKeyForm(true));
  store.dispatch(setSettingsForm(true));
  store.dispatch(setReplyingToMessageData("reply text"));
  store.dispatch(setAttachments([{ secureUrl: "attachment" }]));
  store.dispatch({ type: setChats.type, payload: [{ id: "chat-a" }] });
  store.dispatch(setIsInCall(true));
  store.dispatch(setMyGlobalStream(stream));

  return stop;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("centralized client logout", () => {
  it("clears sensitive state, media, storage, and API caches after server logout", async () => {
    const store = makeStore();
    const stop = populateSensitiveState(store);
    const dispatch = vi.spyOn(store, "dispatch");
    const router = { replace: vi.fn(), refresh: vi.fn() };
    const logoutOnServer = vi.fn().mockResolvedValue(undefined);
    const localStorage = createStorage();
    const sessionStorage = createStorage();

    const result = await performClientLogout({
      logoutOnServer,
      dispatch: store.dispatch,
      getState: store.getState,
      router,
      storage: { localStorage, sessionStorage },
    });

    const state = store.getState();
    expect(result).toEqual({
      status: "complete",
      serverSessionMayRemain: false,
      storageCleared: true,
    });
    expect(logoutOnServer).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(state.authSlice.loggedInUser).toBeNull();
    expect(state.authSlice.authToken).toBeNull();
    expect(state.uiSlice).toMatchObject({
      isDarkMode: true,
      recoverPrivateKeyForm: false,
      settingsForm: false,
      attachments: null,
      replyingToMessageData: null,
    });
    expect(state.chatSlice).toEqual({ selectedChatDetails: null, chats: [] });
    expect(state.callSlice).toMatchObject({
      isInCall: false,
      callHistory: [],
      myGlobalStream: undefined,
    });
    expect(localStorage.removeItem.mock.calls.map(([key]) => key)).toEqual([
      "loggedInUser",
      "authToken",
      "tempPassword",
    ]);
    expect(sessionStorage.removeItem.mock.calls.map(([key]) => key)).toEqual([
      "loggedInUser",
      "authToken",
      "tempPassword",
    ]);
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(expect.arrayContaining([
      attachmentApi.util.resetApiState().type,
      authApi.util.resetApiState().type,
      chatApi.util.resetApiState().type,
      friendApi.util.resetApiState().type,
      messageApi.util.resetApiState().type,
      requestApi.util.resetApiState().type,
      userApi.util.resetApiState().type,
    ]));
    expect(router.replace).toHaveBeenCalledWith("/auth/login");
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(router).not.toHaveProperty("push");
  });

  it("still clears client state when server logout rejects and reports a partial failure", async () => {
    const store = makeStore();
    const stop = populateSensitiveState(store);
    const router = { replace: vi.fn(), refresh: vi.fn() };

    const result = await performClientLogout({
      logoutOnServer: vi.fn().mockRejectedValue(new Error("server unavailable")),
      dispatch: store.dispatch,
      getState: store.getState,
      router,
      storage: { localStorage: createStorage(), sessionStorage: createStorage() },
    });

    expect(result).toEqual({
      status: "server-logout-failed",
      serverSessionMayRemain: true,
      storageCleared: true,
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(store.getState().authSlice.loggedInUser).toBeNull();
    expect(store.getState().authSlice.authToken).toBeNull();
    expect(store.getState().uiSlice.recoverPrivateKeyForm).toBe(false);
    expect(store.getState().chatSlice.chats).toEqual([]);
    expect(store.getState().callSlice.isInCall).toBe(false);
    expect(router.replace).toHaveBeenCalledWith("/auth/login");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("continues Redux, cache, media, and navigation cleanup when storage throws", async () => {
    const store = makeStore();
    const stop = populateSensitiveState(store);
    const dispatch = vi.spyOn(store, "dispatch");
    const router = { replace: vi.fn(), refresh: vi.fn() };
    const throwingStorage = {
      removeItem: vi.fn(() => {
        throw new DOMException("Storage is blocked", "SecurityError");
      }),
    };
    const availableStorage = createStorage();

    const result = await performClientLogout({
      logoutOnServer: vi.fn().mockResolvedValue(undefined),
      dispatch: store.dispatch,
      getState: store.getState,
      router,
      storage: { localStorage: throwingStorage, sessionStorage: availableStorage },
    });

    expect(result.storageCleared).toBe(false);
    expect(throwingStorage.removeItem).toHaveBeenCalledTimes(3);
    expect(availableStorage.removeItem).toHaveBeenCalledTimes(3);
    expect(stop).toHaveBeenCalledOnce();
    expect(store.getState().authSlice.loggedInUser).toBeNull();
    expect(store.getState().uiSlice.recoverPrivateKeyForm).toBe(false);
    expect(dispatch.mock.calls.map(([action]) => action.type)).toContain(
      userApi.util.resetApiState().type,
    );
    expect(router.replace).toHaveBeenCalledWith("/auth/login");
  });

  it("deduplicates an in-flight click and permits a safe retry afterward", async () => {
    const store = makeStore();
    let rejectFirstAttempt: ((reason: Error) => void) | undefined;
    const firstAttempt = new Promise<void>((_resolve, reject) => {
      rejectFirstAttempt = reject;
    });
    const logoutOnServer = vi.fn()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(undefined);
    const onServerLogoutFailure = vi.fn();
    const command = createClientLogoutCommand({
      logoutOnServer,
      dispatch: store.dispatch,
      getState: store.getState,
      router: { replace: vi.fn(), refresh: vi.fn() },
      storage: { localStorage: createStorage(), sessionStorage: createStorage() },
    }, onServerLogoutFailure);

    const firstClick = command();
    const duplicateClick = command();
    expect(duplicateClick).toBe(firstClick);
    expect(logoutOnServer).toHaveBeenCalledOnce();

    rejectFirstAttempt?.(new Error("temporary server failure"));
    await expect(firstClick).resolves.toMatchObject({ status: "server-logout-failed" });
    expect(onServerLogoutFailure).toHaveBeenCalledOnce();

    await expect(command()).resolves.toMatchObject({ status: "complete" });
    expect(logoutOnServer).toHaveBeenCalledTimes(2);
    expect(onServerLogoutFailure).toHaveBeenCalledOnce();
  });

  it("keeps auth reducers pure even when browser storage is unavailable", () => {
    const throwingStorage = {
      removeItem: vi.fn(() => {
        throw new DOMException("Storage is blocked", "SecurityError");
      }),
    };
    vi.stubGlobal("localStorage", throwingStorage);
    const store = makeStore();

    expect(() => {
      store.dispatch(updateLoggedInUser(null));
      store.dispatch(setAuthToken(null));
      store.dispatch(resetAuthState());
    }).not.toThrow();
    expect(throwingStorage.removeItem).not.toHaveBeenCalled();
  });
});

describe("logout call-site wiring", () => {
  it.each([
    "src/components/auth/RecoverPrivateKeyForm.tsx",
    "src/components/navbar/NavMenu.tsx",
    "src/components/auth/OtpVerification.tsx",
  ])("uses the shared logout hook in %s", async (path) => {
    const source = await readFile(resolve(path), "utf8");

    expect(source).toContain("useLogout");
    expect(source).not.toMatch(/\brouter\.push\s*\(/);
    expect(source).not.toMatch(/await\s+logout\s*\(/);
  });
});
