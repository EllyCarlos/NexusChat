import { performance } from "node:perf_hooks";
import type { OperationClock } from "../../../observability/operation-observer.js";
import { logServerError } from "../../../utils/safe-logger.utils.js";
import type { PushNotificationProvider } from "../contracts/push-notification.provider.js";

type SendPushNotificationDependencies = {
  provider: PushNotificationProvider;
  selectFallbackTitle: () => string;
  onDeliveryFailure?: (error: unknown, durationMs: number) => void;
  clock?: OperationClock;
};

export type SendPushNotificationInput = {
  recipientToken: string;
  title?: string;
  body: string;
};

export const createPushNotificationSender = ({
  provider,
  selectFallbackTitle,
  onDeliveryFailure = (error) => logServerError("FCM send failed.", error),
  clock = performance.now.bind(performance),
}: SendPushNotificationDependencies) => ({
  recipientToken,
  title,
  body,
}: SendPushNotificationInput): void => {
  const startedAt = clock();
  const observeFailure = (error: unknown): void => {
    const elapsed = clock() - startedAt;
    const durationMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
    try {
      onDeliveryFailure(error, durationMs);
    } catch {
      // Notification observability must not alter fire-and-forget delivery.
    }
  };

  try {
    const delivery = provider.deliver({
      recipientToken,
      title: title ? title : selectFallbackTitle(),
      body,
    });
    void delivery.catch((error) => {
      observeFailure(error);
    });
  } catch (error) {
    observeFailure(error);
  }
};
