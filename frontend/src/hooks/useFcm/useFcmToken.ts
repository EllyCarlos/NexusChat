"use client";

import { fetchToken, messaging } from "@/lib/firebase/firebase";
import { onMessage, Unsubscribe } from "firebase/messaging";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type FcmTokenLoadResult = {
  token: string | null;
  permission: NotificationPermission;
};

type LoadFcmTokenWithRetryOptions = {
  getPermissionAndToken?: () => Promise<FcmTokenLoadResult | null>;
  maxAttempts?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: () => void;
  onExhausted?: () => void;
};

const MAX_FCM_TOKEN_ATTEMPTS = 4;
const FCM_TOKEN_RETRY_DELAY_MS = 500;

const waitForFcmRetry = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    };
    const timeoutId = setTimeout(finish, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      finish();
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
    }
  });

async function getNotificationPermissionAndToken(): Promise<FcmTokenLoadResult | null> {
  // Step 1: Check if Notifications are supported in the browser.
  if (!("Notification" in window)) {
    return null;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    return { token: null, permission };
  }

  return { token: await fetchToken(), permission };
}

export const loadFcmTokenWithRetry = async ({
  getPermissionAndToken = getNotificationPermissionAndToken,
  maxAttempts = MAX_FCM_TOKEN_ATTEMPTS,
  retryDelayMs = FCM_TOKEN_RETRY_DELAY_MS,
  signal,
  wait = waitForFcmRetry,
  onRetry = () => console.error("Notification token retrieval failed. Retrying."),
  onExhausted = () => console.error("Notification token retrieval failed after retrying."),
}: LoadFcmTokenWithRetryOptions = {}): Promise<FcmTokenLoadResult | null> => {
  const boundedAttempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    if (signal?.aborted) return null;

    const result = await getPermissionAndToken();
    if (signal?.aborted || !result) return null;

    if (result.permission !== "granted" || result.token) {
      return result;
    }

    if (attempt === boundedAttempts - 1) {
      onExhausted();
      return result;
    }

    onRetry();
    await wait(retryDelayMs, signal);
  }

  return null;
};

const useFcmToken = () => {
  const router = useRouter();
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<NotificationPermission | null>(null); // State to store the notification permission status.
  const [token, setToken] = useState<string | null>(null); // State to store the FCM token.
  const isLoading = useRef(false); // Ref to keep track if a token fetch is currently in progress.

  const loadToken = useCallback(async (signal: AbortSignal) => {
    // Step 4: Prevent multiple fetches if already fetched or in progress.
    if (isLoading.current) return null;

    isLoading.current = true; // Mark loading as in progress.
    try {
      return await loadFcmTokenWithRetry({ signal });
    } finally {
      isLoading.current = false;
    }
  },[]);

  useEffect(() => {
    // Step 8: Initialize token loading when the component mounts.
    const controller = new AbortController();

    if ("Notification" in window) {
      void loadToken(controller.signal).then((result) => {
        if (controller.signal.aborted || !result) return;
        setNotificationPermissionStatus(result.permission);
        if (result.token) setToken(result.token);
      });
    }

    return () => controller.abort();
  }, [loadToken]);

  useEffect(() => {
    const setupListener = async () => {
      if (!token) return; // Exit if no token is available.

      const m = await messaging();
      if (!m) return;

      // Step 9: Register a listener for incoming FCM messages.
      const unsubscribe = onMessage(m, (payload) => {
        if (Notification.permission !== "granted") return;

        const link = payload.fcmOptions?.link || payload.data?.link;

        if (link) {
          toast.info(
            `${payload.notification?.title}: ${payload.notification?.body}`,
            {
              action: {
                label: "Visit",
                onClick: () => {
                  const link = payload.fcmOptions?.link || payload.data?.link;
                  if (link) {
                    router.push(link);
                  }
                },
              },
            }
          );
        } else {
          toast.info(
            `${payload.notification?.title}: ${payload.notification?.body}`
          );
        }

        // --------------------------------------------
        // Disable this if you only want toast notifications.
        // const n = new Notification(
        //   payload.notification?.title || "New message",
        //   {
        //     body: payload.notification?.body || "This is a new message",
        //     data: link ? { url: link } : undefined,
        //   }
        // );

        // // Step 10: Handle notification click event to navigate to a link if present.
        // n.onclick = (event) => {
        //   event.preventDefault();
        //   const link = (event.target as any)?.data?.url;
        //   if (link) {
        //     router.push(link);
        //   }
        // };
        // --------------------------------------------
      });

      return unsubscribe;
    };

    let cancelled = false;
    let unsubscribe: Unsubscribe | null = null;

    setupListener().then((unsub) => {
      if (!unsub) return;
      if (cancelled) {
        unsub();
        return;
      }
      unsubscribe = unsub;
    });

    // Step 11: Cleanup the listener when the component unmounts.
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [token, router]);

  return { token, notificationPermissionStatus }; // Return the token and permission status.
};

export default useFcmToken;
