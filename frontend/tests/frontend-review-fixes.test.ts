import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/firebase", () => ({
  fetchToken: vi.fn(),
  messaging: vi.fn(),
}));
vi.mock("firebase/messaging", () => ({ onMessage: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

import {
  createAttachmentPreviewUrls,
  revokeAttachmentPreviewUrls,
} from "@/hooks/useAttachment/useGenerateAttachmentsPreview";
import { checkPrivateKeyAvailability } from "@/hooks/useAuth/useCheckUserPrivateKeyInIndexedDB";
import {
  loadFcmTokenWithRetry,
  type FcmTokenLoadResult,
} from "@/hooks/useFcm/useFcmToken";
import { getPreviousMessageRequest } from "@/hooks/useMessages/useFetchMessagesOnPageChange";

describe("CodeRabbit frontend review regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("FCM token retries", () => {
    it("retries a granted permission with delay until a token succeeds", async () => {
      const getPermissionAndToken = vi.fn<() => Promise<FcmTokenLoadResult | null>>()
        .mockResolvedValueOnce({ permission: "granted", token: null })
        .mockResolvedValueOnce({ permission: "granted", token: null })
        .mockResolvedValueOnce({ permission: "granted", token: "fcm-token" });
      const wait = vi.fn(async () => undefined);
      const onRetry = vi.fn();

      const result = await loadFcmTokenWithRetry({
        getPermissionAndToken,
        wait,
        onRetry,
        onExhausted: vi.fn(),
      });

      expect(result).toEqual({ permission: "granted", token: "fcm-token" });
      expect(getPermissionAndToken).toHaveBeenCalledTimes(3);
      expect(wait).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("stops immediately when notification permission is denied", async () => {
      const getPermissionAndToken = vi.fn(async () => ({
        permission: "denied" as const,
        token: null,
      }));
      const wait = vi.fn(async () => undefined);

      const result = await loadFcmTokenWithRetry({ getPermissionAndToken, wait });

      expect(result).toEqual({ permission: "denied", token: null });
      expect(getPermissionAndToken).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    });

    it("stops without retrying when permission remains default", async () => {
      const getPermissionAndToken = vi.fn(async () => ({
        permission: "default" as const,
        token: null,
      }));
      const wait = vi.fn(async () => undefined);
      const onExhausted = vi.fn();

      const result = await loadFcmTokenWithRetry({
        getPermissionAndToken,
        wait,
        onExhausted,
      });

      expect(result).toEqual({ permission: "default", token: null });
      expect(getPermissionAndToken).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(onExhausted).not.toHaveBeenCalled();
    });

    it("exhausts only the bounded granted-permission attempts", async () => {
      const getPermissionAndToken = vi.fn(async () => ({
        permission: "granted" as const,
        token: null,
      }));
      const wait = vi.fn(async () => undefined);
      const onRetry = vi.fn();
      const onExhausted = vi.fn();

      const result = await loadFcmTokenWithRetry({
        getPermissionAndToken,
        maxAttempts: 4,
        wait,
        onRetry,
        onExhausted,
      });

      expect(result).toEqual({ permission: "granted", token: null });
      expect(getPermissionAndToken).toHaveBeenCalledTimes(4);
      expect(wait).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(3);
      expect(onExhausted).toHaveBeenCalledTimes(1);
    });
  });

  it("skips an inherited page after chat change and resumes later pagination", () => {
    const previousSelectedChatIdRef = { current: "chat-a" as string | undefined };
    const lastRequestKeyRef = { current: "chat-a:3" as string | undefined };

    const inheritedPageDecision = getPreviousMessageRequest({
      selectedChatId: "chat-b",
      page: 3,
      hasMoreMessages: true,
      isFetching: false,
      previousSelectedChatIdRef,
      lastRequestKeyRef,
    });
    const resetPageDecision = getPreviousMessageRequest({
      selectedChatId: "chat-b",
      page: 1,
      hasMoreMessages: true,
      isFetching: false,
      previousSelectedChatIdRef,
      lastRequestKeyRef,
    });
    const laterPageDecision = getPreviousMessageRequest({
      selectedChatId: "chat-b",
      page: 2,
      hasMoreMessages: true,
      isFetching: false,
      previousSelectedChatIdRef,
      lastRequestKeyRef,
    });

    expect(inheritedPageDecision).toEqual({ chatChanged: true, request: null });
    expect(resetPageDecision).toEqual({ chatChanged: false, request: null });
    expect(laterPageDecision).toEqual({
      chatChanged: false,
      request: { chatId: "chat-b", page: 2 },
    });
  });

  it("creates attachment previews and revokes exactly the generated URLs", () => {
    const attachments = [new Blob(["first"]), new Blob(["second"])];
    const createObjectUrl = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const previewUrls = createAttachmentPreviewUrls(attachments);
    revokeAttachmentPreviewUrls(previewUrls);

    expect(previewUrls).toEqual(["blob:first", "blob:second"]);
    expect(createObjectUrl).toHaveBeenNthCalledWith(1, attachments[0]);
    expect(createObjectUrl).toHaveBeenNthCalledWith(2, attachments[1]);
    expect(revokeObjectUrl.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
  });

  describe("private-key availability lookup", () => {
    it("opens recovery when a successful lookup has no private key", async () => {
      const onRecoveryRequired = vi.fn();

      await checkPrivateKeyAvailability({
        userId: "user-1",
        getPrivateKey: async () => null,
        isCancelled: () => false,
        onRecoveryRequired,
      });

      expect(onRecoveryRequired).toHaveBeenCalledTimes(1);
    });

    it("does not open recovery when a private key exists", async () => {
      const onRecoveryRequired = vi.fn();

      await checkPrivateKeyAvailability({
        userId: "user-1",
        getPrivateKey: async () => ({ kty: "EC" }),
        isCancelled: () => false,
        onRecoveryRequired,
      });

      expect(onRecoveryRequired).not.toHaveBeenCalled();
    });

    it("fails closed through recovery after a sanitized lookup failure", async () => {
      const onRecoveryRequired = vi.fn();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await checkPrivateKeyAvailability({
        userId: "user-1",
        getPrivateKey: async () => { throw new Error("raw IndexedDB failure"); },
        isCancelled: () => false,
        onRecoveryRequired,
      });

      expect(onRecoveryRequired).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith("Unable to verify private-key storage.");
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain("raw IndexedDB failure");
    });

    it("does nothing after cancellation even when lookup rejects", async () => {
      const onRecoveryRequired = vi.fn();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await checkPrivateKeyAvailability({
        userId: "user-1",
        getPrivateKey: async () => { throw new Error("raw IndexedDB failure"); },
        isCancelled: () => true,
        onRecoveryRequired,
      });

      expect(onRecoveryRequired).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});
