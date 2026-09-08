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
  status:
    | "complete"
    | "storage-cleanup-failed"
    | "server-logout-failed"
    | "server-and-storage-cleanup-failed";
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

type ClientStorageAccess = {
  storage?: ClientStorage;
  accessFailed: boolean;
};

const readBrowserStorage = (
  name: "localStorage" | "sessionStorage",
): ClientStorageAccess => {
  try {
    return { storage: globalThis[name], accessFailed: false };
  } catch {
    return { accessFailed: true };
  }
};

const resolveClientStorage = (
  storage: ClientStorageDependencies,
  name: "localStorage" | "sessionStorage",
): ClientStorageAccess => {
  try {
    const providedStorage = storage[name];
    return providedStorage
      ? { storage: providedStorage, accessFailed: false }
      : readBrowserStorage(name);
  } catch {
    return { accessFailed: true };
  }
};

export const clearClientSessionStorage = (
  storage: ClientStorageDependencies = {},
) => {
  const storages = [
    resolveClientStorage(storage, "localStorage"),
    resolveClientStorage(storage, "sessionStorage"),
  ];
  let storageCleared = storages.every(({ accessFailed }) => !accessFailed);

  for (const { storage: clientStorage } of storages) {
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

const getClientLogoutStatus = (
  serverLogoutSucceeded: boolean,
  storageCleared: boolean,
): ClientLogoutResult["status"] => {
  if (serverLogoutSucceeded && storageCleared) return "complete";
  if (serverLogoutSucceeded) return "storage-cleanup-failed";
  return storageCleared
    ? "server-logout-failed"
    : "server-and-storage-cleanup-failed";
};

export const getClientLogoutFailureMessage = (result: ClientLogoutResult) => {
  if (result.status === "complete") {
    return "Logout completed.";
  }
  if (result.status === "storage-cleanup-failed") {
    return "Server logout succeeded, but browser storage could not be fully cleared. Clear this site's data before signing in again.";
  }
  if (result.status === "server-and-storage-cleanup-failed") {
    return "Server logout failed and browser storage could not be fully cleared. Please retry logout and clear this site's data.";
  }
  return "Client session state was cleared, but the server logout failed. Please try signing out again.";
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
    status: getClientLogoutStatus(serverLogoutSucceeded, storageCleared),
    serverSessionMayRemain: !serverLogoutSucceeded,
    storageCleared,
  };
};

export const createClientLogoutCommand = (
  dependencies: ClientLogoutDependencies,
  onIncompleteLogout?: (result: ClientLogoutResult) => void,
) => {
  let inFlight: Promise<ClientLogoutResult> | null = null;

  return () => {
    if (inFlight) return inFlight;

    const attempt = performClientLogout(dependencies).then((result) => {
      if (result.status !== "complete") {
        onIncompleteLogout?.(result);
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
      (result) => toast.error(getClientLogoutFailureMessage(result)),
    ),
    [dispatch, router, store],
  );
};
