import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatAttachmentReader } from "../src/modules/read-queries/application/get-chat-attachments.js";
import { createChatMessageReader } from "../src/modules/read-queries/application/get-chat-messages.js";
import { createUserChatLister } from "../src/modules/read-queries/application/get-user-chats.js";
import type { AttachmentReadRepository } from "../src/modules/read-queries/contracts/attachment-read.repository.js";
import type { ChatReadRepository } from "../src/modules/read-queries/contracts/chat-read.repository.js";
import type { MessageReadRepository } from "../src/modules/read-queries/contracts/message-read.repository.js";

const USER_ID = "authenticated-user";
const CHAT_ID = "chat-1";

const chatRepository = {
  listChatsForUser: vi.fn(),
} as unknown as ChatReadRepository;

const messageRepository = {
  listMessages: vi.fn(),
  countMessages: vi.fn(),
} as unknown as MessageReadRepository;

const attachmentRepository = {
  listAttachments: vi.fn(),
  countAttachments: vi.fn(),
} as unknown as AttachmentReadRepository;

const listUserChats = createUserChatLister({ repository: chatRepository });
const getChatMessages = createChatMessageReader({ repository: messageRepository });
const getChatAttachments = createChatAttachmentReader({ repository: attachmentRepository });

const expectCalledBefore = (
  first: { mock: { invocationCallOrder: number[] } },
  second: { mock: { invocationCallOrder: number[] } },
) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

describe("read-query application services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("user chat listing", () => {
    it("queries by trusted user ID and adds independent typing arrays without mutating records", async () => {
      const firstChat = { id: "chat-1", name: "First" };
      const secondChat = { id: "chat-2", name: "Second" };
      vi.mocked(chatRepository.listChatsForUser).mockResolvedValue([
        firstChat,
        secondChat,
      ] as never);

      const result = await listUserChats(USER_ID);

      expect(chatRepository.listChatsForUser).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual([
        { ...firstChat, typingUsers: [] },
        { ...secondChat, typingUsers: [] },
      ]);
      expect(result[0]).not.toBe(firstChat);
      expect(result[1]).not.toBe(secondChat);
      expect(result[0]?.typingUsers).not.toBe(result[1]?.typingUsers);
      expect(firstChat).not.toHaveProperty("typingUsers");
      expect(secondChat).not.toHaveProperty("typingUsers");
    });

    it("forwards repository failures unchanged", async () => {
      const failure = new Error("chat list failed");
      vi.mocked(chatRepository.listChatsForUser).mockRejectedValue(failure);

      await expect(listUserChats(USER_ID)).rejects.toBe(failure);
    });
  });

  describe("message pagination", () => {
    it("uses 1/20 defaults, reads sequentially, reverses in place, and calculates pages", async () => {
      const newerMessage = { id: "message-2" };
      const olderMessage = { id: "message-1" };
      const messages = [newerMessage, olderMessage];
      vi.mocked(messageRepository.listMessages).mockResolvedValue(messages as never);
      vi.mocked(messageRepository.countMessages).mockResolvedValue(21);

      const result = await getChatMessages({ chatId: CHAT_ID });

      expect(messageRepository.listMessages).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        skip: 0,
        take: 20,
      });
      expect(messageRepository.countMessages).toHaveBeenCalledWith(CHAT_ID);
      expectCalledBefore(
        vi.mocked(messageRepository.listMessages),
        vi.mocked(messageRepository.countMessages),
      );
      expect(messages).toEqual([olderMessage, newerMessage]);
      expect(result).toEqual({ messages, totalPages: 2 });
    });

    it("preserves raw Number coercion, ceil skip, and an uncapped limit", async () => {
      vi.mocked(messageRepository.listMessages).mockResolvedValue([]);
      vi.mocked(messageRepository.countMessages).mockResolvedValue(0);

      await getChatMessages({
        chatId: CHAT_ID,
        page: "1.2",
        limit: "1000000",
      });

      expect(messageRepository.listMessages).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        skip: 200000,
        take: 1_000_000,
      });
    });

    it("does not count when page lookup fails", async () => {
      const failure = new Error("message list failed");
      vi.mocked(messageRepository.listMessages).mockRejectedValue(failure);

      await expect(getChatMessages({ chatId: CHAT_ID })).rejects.toBe(failure);
      expect(messageRepository.countMessages).not.toHaveBeenCalled();
    });

    it("does not reverse messages when count fails", async () => {
      const newerMessage = { id: "message-2" };
      const olderMessage = { id: "message-1" };
      const messages = [newerMessage, olderMessage];
      const failure = new Error("message count failed");
      vi.mocked(messageRepository.listMessages).mockResolvedValue(messages as never);
      vi.mocked(messageRepository.countMessages).mockRejectedValue(failure);

      await expect(getChatMessages({ chatId: CHAT_ID })).rejects.toBe(failure);
      expect(messages).toEqual([newerMessage, olderMessage]);
    });
  });

  describe("attachment pagination", () => {
    it("uses 1/6 defaults, reads sequentially, and returns current totals", async () => {
      const attachments = [{ secureUrl: "https://media.example/attachment-1" }];
      vi.mocked(attachmentRepository.listAttachments).mockResolvedValue(attachments);
      vi.mocked(attachmentRepository.countAttachments).mockResolvedValue(7);

      const result = await getChatAttachments({ chatId: CHAT_ID });

      expect(attachmentRepository.listAttachments).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        skip: 0,
        take: 6,
      });
      expect(attachmentRepository.countAttachments).toHaveBeenCalledWith(CHAT_ID);
      expectCalledBefore(
        vi.mocked(attachmentRepository.listAttachments),
        vi.mocked(attachmentRepository.countAttachments),
      );
      expect(result).toEqual({
        attachments,
        totalAttachmentsCount: 7,
        totalPages: 2,
      });
    });

    it("preserves invalid pagination values for the repository boundary", async () => {
      vi.mocked(attachmentRepository.listAttachments).mockResolvedValue([]);
      vi.mocked(attachmentRepository.countAttachments).mockResolvedValue(0);

      await getChatAttachments({
        chatId: CHAT_ID,
        page: "invalid",
        limit: "invalid",
      });

      expect(attachmentRepository.listAttachments).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        skip: Number.NaN,
        take: Number.NaN,
      });
    });

    it("does not count when attachment lookup fails", async () => {
      const failure = new Error("attachment list failed");
      vi.mocked(attachmentRepository.listAttachments).mockRejectedValue(failure);

      await expect(getChatAttachments({ chatId: CHAT_ID })).rejects.toBe(failure);
      expect(attachmentRepository.countAttachments).not.toHaveBeenCalled();
    });

    it("forwards count failures after the page has been read", async () => {
      const attachments = [{ secureUrl: "https://media.example/attachment-1" }];
      const failure = new Error("attachment count failed");
      vi.mocked(attachmentRepository.listAttachments).mockResolvedValue(attachments);
      vi.mocked(attachmentRepository.countAttachments).mockRejectedValue(failure);

      await expect(getChatAttachments({ chatId: CHAT_ID })).rejects.toBe(failure);
      expect(attachmentRepository.listAttachments).toHaveBeenCalledOnce();
      expect(attachments).toEqual([{ secureUrl: "https://media.example/attachment-1" }]);
    });
  });
});
