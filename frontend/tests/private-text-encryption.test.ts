import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  encryptMessage: vi.fn<({ message, sharedKey }: {
    message: string;
    sharedKey: CryptoKey;
  }) => Promise<string | null>>(),
  getSharedKey: vi.fn<() => Promise<CryptoKey | undefined>>(),
  toastError: vi.fn(),
  state: {
    authSlice: { loggedInUser: null as unknown },
    chatSlice: { selectedChatDetails: null as unknown },
    uiSlice: { replyingToMessageId: null as string | null },
  },
}));

vi.mock("@/context/socket.context", () => ({
  useSocket: () => ({ emit: mocks.emit }),
}));

vi.mock("@/lib/client/encryption", () => ({
  encryptMessage: mocks.encryptMessage,
}));

vi.mock("@/lib/client/store/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));

vi.mock("@/hooks/useAuth/useGetSharedKey", () => ({
  useGetSharedKey: () => ({ getSharedKey: mocks.getSharedKey }),
}));

vi.mock("@/lib/shared/helpers", () => ({
  getOtherMemberOfPrivateChat: () => ({
    user: { id: "other-user", publicKey: "public-key" },
  }),
}));

vi.mock("react-hot-toast", () => ({
  default: { error: mocks.toastError },
}));

import { Event } from "@/interfaces/events.interface";
import { useEditMessage } from "@/hooks/useMessages/useEditMessage";
import { useSendMessage } from "@/hooks/useMessages/useSendMessage";

const PLAINTEXT = "private message plaintext";
const CIPHERTEXT = "encrypted-message-payload";
const SHARED_KEY = {} as CryptoKey;

const selectChat = (isGroupChat: boolean) => {
  mocks.state.authSlice.loggedInUser = { id: "actor-user" };
  mocks.state.chatSlice.selectedChatDetails = {
    id: isGroupChat ? "group-chat" : "private-chat",
    isGroupChat,
  };
};

describe("private text encryption fail-closed behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.uiSlice.replyingToMessageId = null;
    selectChat(false);
    mocks.getSharedKey.mockResolvedValue(SHARED_KEY);
    mocks.encryptMessage.mockResolvedValue(CIPHERTEXT);
  });

  describe("send", () => {
    it("emits the encrypted private message without the original plaintext", async () => {
      const result = await useSendMessage().sendMessage(PLAINTEXT);

      expect(result).toBe(true);
      expect(mocks.emit).toHaveBeenCalledWith(Event.MESSAGE, expect.objectContaining({
        chatId: "private-chat",
        textMessageContent: CIPHERTEXT,
      }));
      expect(mocks.emit).not.toHaveBeenCalledWith(
        Event.MESSAGE,
        expect.objectContaining({ textMessageContent: PLAINTEXT }),
      );
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it("does not emit when the private shared key is unavailable", async () => {
      mocks.getSharedKey.mockResolvedValue(undefined);

      const result = await useSendMessage().sendMessage(PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to securely send this message. Please try again.",
      );
    });

    it("does not emit when private encryption throws", async () => {
      mocks.encryptMessage.mockRejectedValue(new Error("sensitive encryption failure"));

      const result = await useSendMessage().sendMessage(PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to securely send this message. Please try again.",
      );
    });

    it("does not emit when private shared-key retrieval throws", async () => {
      mocks.getSharedKey.mockRejectedValue(new Error("sensitive key failure"));

      const result = await useSendMessage().sendMessage(PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to securely send this message. Please try again.",
      );
    });

    it("does not emit private plaintext when authenticated user state is unavailable", async () => {
      mocks.state.authSlice.loggedInUser = null;

      const result = await useSendMessage().sendMessage(PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.getSharedKey).not.toHaveBeenCalled();
      expect(mocks.emit).not.toHaveBeenCalled();
    });

    it.each([null, "", "   ", PLAINTEXT])(
      "does not emit an unusable private encryption result %#",
      async (encryptedOutput) => {
        mocks.encryptMessage.mockResolvedValue(encryptedOutput);

        const result = await useSendMessage().sendMessage(PLAINTEXT);

        expect(result).toBe(false);
        expect(mocks.emit).not.toHaveBeenCalled();
      },
    );

    it("keeps group plaintext behavior unchanged", async () => {
      selectChat(true);

      const result = await useSendMessage().sendMessage(PLAINTEXT);

      expect(result).toBe(true);
      expect(mocks.getSharedKey).not.toHaveBeenCalled();
      expect(mocks.encryptMessage).not.toHaveBeenCalled();
      expect(mocks.emit).toHaveBeenCalledWith(Event.MESSAGE, expect.objectContaining({
        chatId: "group-chat",
        textMessageContent: PLAINTEXT,
      }));
    });
  });

  describe("edit", () => {
    it("emits the encrypted private edit without the original plaintext", async () => {
      const result = await useEditMessage().editMessage("message-id", PLAINTEXT);

      expect(result).toBe(true);
      expect(mocks.emit).toHaveBeenCalledWith(Event.MESSAGE_EDIT, {
        chatId: "private-chat",
        messageId: "message-id",
        updatedTextContent: CIPHERTEXT,
      });
      expect(mocks.emit).not.toHaveBeenCalledWith(
        Event.MESSAGE_EDIT,
        expect.objectContaining({ updatedTextContent: PLAINTEXT }),
      );
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it("does not emit when the private edit shared key is unavailable", async () => {
      mocks.getSharedKey.mockResolvedValue(undefined);

      const result = await useEditMessage().editMessage("message-id", PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to securely update this message. Please try again.",
      );
    });

    it("does not emit when private edit encryption throws", async () => {
      mocks.encryptMessage.mockRejectedValue(new Error("sensitive encryption failure"));

      const result = await useEditMessage().editMessage("message-id", PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to securely update this message. Please try again.",
      );
    });

    it("does not emit when private edit shared-key retrieval throws", async () => {
      mocks.getSharedKey.mockRejectedValue(new Error("sensitive key failure"));

      const result = await useEditMessage().editMessage("message-id", PLAINTEXT);

      expect(result).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Unable to securely update this message. Please try again.",
      );
    });

    it.each([null, "", "   ", PLAINTEXT])(
      "does not emit an unusable private edit encryption result %#",
      async (encryptedOutput) => {
        mocks.encryptMessage.mockResolvedValue(encryptedOutput);

        const result = await useEditMessage().editMessage("message-id", PLAINTEXT);

        expect(result).toBe(false);
        expect(mocks.emit).not.toHaveBeenCalled();
      },
    );

    it("keeps group plaintext edit behavior unchanged", async () => {
      selectChat(true);

      const result = await useEditMessage().editMessage("message-id", PLAINTEXT);

      expect(result).toBe(true);
      expect(mocks.getSharedKey).not.toHaveBeenCalled();
      expect(mocks.encryptMessage).not.toHaveBeenCalled();
      expect(mocks.emit).toHaveBeenCalledWith(Event.MESSAGE_EDIT, {
        chatId: "group-chat",
        messageId: "message-id",
        updatedTextContent: PLAINTEXT,
      });
    });
  });
});
