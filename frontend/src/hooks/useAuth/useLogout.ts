"use client";

import { logout } from "@/actions/auth.actions";
import { attachmentApi } from "@/lib/client/rtk-query/attachment.api";
import { authApi } from "@/lib/client/rtk-query/auth.api";
import { chatApi } from "@/lib/client/rtk-query/chat.api";
import { friendApi } from "@/lib/client/rtk-query/friend.api";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { requestApi } from "@/lib/client/rtk-query/request.api";
import { userApi } from "@/lib/client/rtk-query/user.api";
import { resetAuthState } from "@/lib/client/slices/authSlice";
import { resetCallState } from "@/lib/client/slices/callSlice";
import { resetChatState } from "@/lib/client/slices/chatSlice";
import { resetSessionUiState } from "@/lib/client/slices/uiSlice";
import {
  useAppDispatch,
  useAppStore,
} from "@/lib/client/store/hooks";
import type { AppDispatch, RootState } from "@/lib/client/store/store";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import toast from "react-hot-toast";

type LogoutRouter = {
  replace: (href: string) => void;
  refresh: () => void;
};

type ClientLogoutDependencies = {
  logoutOnServer: () => Promise<void>;
  dispatch: AppDispatch;
  getState: () => RootState;
  router: LogoutRouter;
  storage?: ClientStorageDependencies;
};

type ClientStorage = Pick<Storage, "removeItem">;

type ClientStorageDependencies = {
  localStorage?: ClientStorage;
  sessionStorage?: ClientStorage;
};

export type ClientLogoutResult = {
  status: "complete" | "server-logout-failed";
  serverSessionMayRemain: boolean;
  storageCleared: boolean;
};

const apiCaches = [
  attachmentApi,
  authApi,
  chatApi,
  friendApi,
  messageApi,
  requestApi,
  userApi,
] as const;

const stopActiveMedia = (state: RootState) => {
  try {
    state.callSlice.myGlobalStream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Continue clearing the session if a browser track is already unavailable.
      }
    });
  } catch {
    // Continue clearing the session if the browser stream can no longer be read.
  }
};

const authStorageKeys = ["loggedInUser", "authToken", "tempPassword"] as const;

const readBrowserStorage = (name: "localStorage" | "sessionStorage") => {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
};

export const clearClientSessionStorage = (
  storage: ClientStorageDependencies = {},
) => {
  const storages = [
    storage.localStorage ?? readBrowserStorage("localStorage"),
    storage.sessionStorage ?? readBrowserStorage("sessionStorage"),
  ];
  let storageCleared = true;

  for (const clientStorage of storages) {
    if (!clientStorage) continue;

    for (const key of authStorageKeys) {
      try {
        clientStorage.removeItem(key);
      } catch {
        storageCleared = false;
      }
    }
  }

  return storageCleared;
};

export const performClientLogout = async ({
  logoutOnServer,
  dispatch,
  getState,
  router,
  storage,
}: ClientLogoutDependencies): Promise<ClientLogoutResult> => {
  let serverLogoutSucceeded = false;
  let storageCleared = true;

  try {
    await logoutOnServer();
    serverLogoutSucceeded = true;
  } catch {
    serverLogoutSucceeded = false;
  } finally {
    stopActiveMedia(getState());
    storageCleared = clearClientSessionStorage(storage);
    dispatch(resetAuthState());
    dispatch(resetSessionUiState());
    dispatch(resetChatState());
    dispatch(resetCallState());
    apiCaches.forEach((api) => dispatch(api.util.resetApiState()));

    router.replace("/auth/login");
    if (serverLogoutSucceeded) {
      router.refresh();
    }
  }

  return {
    status: serverLogoutSucceeded ? "complete" : "server-logout-failed",
    serverSessionMayRemain: !serverLogoutSucceeded,
    storageCleared,
  };
};

export const createClientLogoutCommand = (
  dependencies: ClientLogoutDependencies,
  onServerLogoutFailure?: () => void,
) => {
  let inFlight: Promise<ClientLogoutResult> | null = null;

  return () => {
    if (inFlight) return inFlight;

    const attempt = performClientLogout(dependencies).then((result) => {
      if (result.status === "server-logout-failed") {
        onServerLogoutFailure?.();
      }
      return result;
    });
    const trackedAttempt = attempt.finally(() => {
      if (inFlight === trackedAttempt) {
        inFlight = null;
      }
    });
    inFlight = trackedAttempt;
    return trackedAttempt;
  };
};

export const useLogout = () => {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const router = useRouter();

  return useMemo(
    () => createClientLogoutCommand(
      {
        logoutOnServer: logout,
        dispatch,
        getState: store.getState,
        router,
      },
      () => toast.error(
        "Local session data was cleared, but the server logout failed. Please try signing out again.",
      ),
    ),
    [dispatch, router, store],
  );
};
