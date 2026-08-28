import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMocks = vi.hoisted(() => ({
  logServerError: vi.fn(),
}));

vi.mock("../src/utils/safe-logger.utils.js", () => ({
  logServerError: loggerMocks.logServerError,
}));

import { createChatAttachmentUploader } from "../src/modules/attachments/application/upload-chat-attachments.js";
import type { AttachmentMediaPort } from "../src/modules/attachments/contracts/attachment-media.port.js";
import type { AttachmentRealtimePort } from "../src/modules/attachments/contracts/attachment-realtime.port.js";
import type { AttachmentRepository } from "../src/modules/attachments/contracts/attachment.repository.js";
import type {
  AttachmentMessageView,
  AttachmentUpload,
} from "../src/modules/attachments/contracts/attachment.types.js";
import { CustomError } from "../src/utils/error.utils.js";

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";
const createdAt = new Date("2025-02-12T09:30:00.000Z");
const updatedAt = new Date("2025-02-12T09:30:01.000Z");

const uploadedAttachments: AttachmentUpload[] = [
  {
    publicId: "attachment-public-id-1",
    secureUrl: "https://media.example/first.png",
  },
  {
    publicId: "attachment-public-id-2",
    secureUrl: "https://media.example/second.pdf",
  },
];

const attachmentMessage = ({
  attachments = uploadedAttachments.map(({ secureUrl }) => ({ secureUrl })),
}: {
  attachments?: Array<{ secureUrl: string }>;
} = {}): AttachmentMessageView => ({
  id: "message-1",
  isTextMessage: true,
  textMessageContent: null,
  chatId: CHAT_ID,
  url: null,
  isPollMessage: false,
  audioUrl: null,
  isEdited: false,
  replyToMessageId: null,
  isPinned: false,
  createdAt,
  updatedAt,
  sender: {
    id: ACTOR_ID,
    username: "actor-username",
    avatar: "https://media.example/actor-avatar.png",
  },
  attachments,
  poll: null,
  reactions: [],
});

const createDependencies = ({
  message = attachmentMessage(),
  uploads = uploadedAttachments,
}: {
  message?: AttachmentMessageView;
  uploads?: AttachmentUpload[];
} = {}) => {
  const media = {
    uploadAttachments: vi.fn(async () => uploads),
    deleteAttachments: vi.fn(async () => undefined),
  } satisfies AttachmentMediaPort;
  const repository = {
    createAttachmentMessage: vi.fn(async () => message),
    upsertUnreadMessage: vi.fn(async () => undefined),
  } satisfies AttachmentRepository;
  const realtime = {
    emitMessage: vi.fn(),
    emitUnreadMessage: vi.fn(),
  } satisfies AttachmentRealtimePort;

  return {
    media,
    repository,
    realtime,
    upload: createChatAttachmentUploader({ media, repository, realtime }),
  };
};

const input = ({
  memberIds = [ACTOR_ID, "member-2", "member-3"],
  expectedUploadCount = uploadedAttachments.length,
}: {
  memberIds?: string[];
  expectedUploadCount?: number;
} = {}) => ({
  actorId: ACTOR_ID,
  chatId: CHAT_ID,
  memberIds,
  expectedUploadCount,
});

const expectBefore = (
  first: ReturnType<typeof vi.fn>,
  second: ReturnType<typeof vi.fn>,
  firstIndex = 0,
  secondIndex = 0,
) => {
  expect(first.mock.invocationCallOrder[firstIndex])
    .toBeLessThan(second.mock.invocationCallOrder[secondIndex]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createChatAttachmentUploader success ordering", () => {
  it("uploads, persists the exact provider-neutral input, emits MESSAGE, writes unreads concurrently, then emits the legacy unread payload", async () => {
    const { media, repository, realtime, upload } = createDependencies();

    await expect(upload(input())).resolves.toBeUndefined();

    expect(media.uploadAttachments).toHaveBeenCalledOnce();
    expect(media.uploadAttachments).toHaveBeenCalledWith();
    expect(repository.createAttachmentMessage).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      chatId: CHAT_ID,
      attachments: uploadedAttachments,
    });
    expect(realtime.emitMessage).toHaveBeenCalledWith(
      CHAT_ID,
      attachmentMessage(),
    );
    expect(repository.upsertUnreadMessage).toHaveBeenNthCalledWith(1, {
      actorId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: "message-1",
      userId: "member-2",
    });
    expect(repository.upsertUnreadMessage).toHaveBeenNthCalledWith(2, {
      actorId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: "message-1",
      userId: "member-3",
    });
    expect(realtime.emitUnreadMessage).toHaveBeenCalledWith(CHAT_ID, {
      chatId: CHAT_ID,
      message: {
        attachments: true,
        createdAt,
      },
      sender: {
        id: ACTOR_ID,
        avatar: "https://media.example/actor-avatar.png",
        username: "https://media.example/actor-avatar.png",
      },
    });
    expectBefore(media.uploadAttachments, repository.createAttachmentMessage);
    expectBefore(repository.createAttachmentMessage, realtime.emitMessage);
    expectBefore(realtime.emitMessage, repository.upsertUnreadMessage, 0, 0);
    expectBefore(repository.upsertUnreadMessage, realtime.emitUnreadMessage, 0, 0);
    expectBefore(repository.upsertUnreadMessage, realtime.emitUnreadMessage, 1, 0);
    expect(media.deleteAttachments).not.toHaveBeenCalled();
  });

  it("filters only the actor, preserves remaining member order and duplicates, and still emits unread when no writes are needed", async () => {
    const { repository, realtime, upload } = createDependencies({
      message: attachmentMessage({ attachments: [] }),
    });

    await upload(input({
      memberIds: [ACTOR_ID, ACTOR_ID],
    }));

    expect(repository.upsertUnreadMessage).not.toHaveBeenCalled();
    expect(realtime.emitMessage).toHaveBeenCalledOnce();
    expect(realtime.emitUnreadMessage).toHaveBeenCalledWith(CHAT_ID, {
      chatId: CHAT_ID,
      message: {
        attachments: false,
        createdAt,
      },
      sender: {
        id: ACTOR_ID,
        avatar: "https://media.example/actor-avatar.png",
        username: "https://media.example/actor-avatar.png",
      },
    });
    expectBefore(realtime.emitMessage, realtime.emitUnreadMessage);
  });

  it("does not deduplicate non-actor member IDs", async () => {
    const { repository, upload } = createDependencies();

    await upload(input({
      memberIds: [ACTOR_ID, "member-2", "member-2"],
    }));

    expect(repository.upsertUnreadMessage).toHaveBeenCalledTimes(2);
    expect(repository.upsertUnreadMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: "member-2",
    }));
    expect(repository.upsertUnreadMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userId: "member-2",
    }));
  });
});

describe("createChatAttachmentUploader pre-commit failures", () => {
  it("maps media upload rejection without a second rollback because the adapter owns partial-upload compensation", async () => {
    const { media, repository, realtime, upload } = createDependencies();
    media.uploadAttachments.mockRejectedValue(new Error("provider details"));

    await expect(upload(input())).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to upload attachments",
    });

    expect(media.deleteAttachments).not.toHaveBeenCalled();
    expect(repository.createAttachmentMessage).not.toHaveBeenCalled();
    expect(repository.upsertUnreadMessage).not.toHaveBeenCalled();
    expect(realtime.emitMessage).not.toHaveBeenCalled();
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
  });

  it("rolls back every returned public ID when the upload result count is incomplete", async () => {
    const incompleteUploads = [uploadedAttachments[0]!];
    const { media, repository, realtime, upload } = createDependencies({
      uploads: incompleteUploads,
    });

    await expect(upload(input({ expectedUploadCount: 2 }))).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to upload attachments",
    });

    expect(media.deleteAttachments).toHaveBeenCalledWith([
      "attachment-public-id-1",
    ]);
    expectBefore(media.uploadAttachments, media.deleteAttachments);
    expect(repository.createAttachmentMessage).not.toHaveBeenCalled();
    expect(repository.upsertUnreadMessage).not.toHaveBeenCalled();
    expect(realtime.emitMessage).not.toHaveBeenCalled();
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
  });

  it("rolls back every uploaded public ID when message persistence fails", async () => {
    const { media, repository, realtime, upload } = createDependencies();
    repository.createAttachmentMessage.mockRejectedValue(new Error("database details"));

    await expect(upload(input())).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to upload attachments",
    });

    expect(media.deleteAttachments).toHaveBeenCalledWith([
      "attachment-public-id-1",
      "attachment-public-id-2",
    ]);
    expectBefore(repository.createAttachmentMessage, media.deleteAttachments);
    expect(repository.upsertUnreadMessage).not.toHaveBeenCalled();
    expect(realtime.emitMessage).not.toHaveBeenCalled();
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
  });

  it("safe-logs rollback rejection and preserves the original CustomError", async () => {
    const originalError = new CustomError("Original persistence failure", 409);
    const rollbackError = new Error("provider rollback details");
    const { media, repository, upload } = createDependencies();
    repository.createAttachmentMessage.mockRejectedValue(originalError);
    media.deleteAttachments.mockRejectedValue(rollbackError);

    await expect(upload(input())).rejects.toBe(originalError);

    expect(media.deleteAttachments).toHaveBeenCalledWith([
      "attachment-public-id-1",
      "attachment-public-id-2",
    ]);
    expect(loggerMocks.logServerError).toHaveBeenCalledWith(
      "New attachment rollback failed.",
      rollbackError,
    );
  });
});

describe("createChatAttachmentUploader post-commit failure cutoffs", () => {
  it("retains committed media and stops before unread writes when MESSAGE emission throws", async () => {
    const { media, repository, realtime, upload } = createDependencies();
    realtime.emitMessage.mockImplementation(() => {
      throw new Error("message event details");
    });

    await expect(upload(input())).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to upload attachments",
    });

    expect(repository.createAttachmentMessage).toHaveBeenCalledOnce();
    expect(realtime.emitMessage).toHaveBeenCalledOnce();
    expect(repository.upsertUnreadMessage).not.toHaveBeenCalled();
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
    expect(media.deleteAttachments).not.toHaveBeenCalled();
  });

  it("starts all unread writes concurrently, permits partial completion, and suppresses UNREAD_MESSAGE after one rejects", async () => {
    let resolveFirst!: () => void;
    let rejectSecond!: (reason: unknown) => void;
    let resolveThird!: () => void;
    const firstUnread = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const secondUnread = new Promise<void>((_resolve, reject) => { rejectSecond = reject; });
    const thirdUnread = new Promise<void>((resolve) => { resolveThird = resolve; });
    const { media, repository, realtime, upload } = createDependencies();
    repository.upsertUnreadMessage
      .mockReturnValueOnce(firstUnread)
      .mockReturnValueOnce(secondUnread)
      .mockReturnValueOnce(thirdUnread);

    const pendingUpload = upload(input({
      memberIds: [ACTOR_ID, "member-2", "member-3", "member-4"],
    }));
    await vi.waitFor(() => {
      expect(repository.upsertUnreadMessage).toHaveBeenCalledTimes(3);
    });

    expect(realtime.emitMessage).toHaveBeenCalledOnce();
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
    resolveFirst();
    rejectSecond(new Error("unread persistence details"));
    resolveThird();

    await expect(pendingUpload).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to upload attachments",
    });
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
    expect(media.deleteAttachments).not.toHaveBeenCalled();
  });

  it("retains committed message, media, and unread writes when UNREAD_MESSAGE emission throws", async () => {
    const { media, repository, realtime, upload } = createDependencies();
    realtime.emitUnreadMessage.mockImplementation(() => {
      throw new Error("unread event details");
    });

    await expect(upload(input())).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to upload attachments",
    });

    expect(repository.createAttachmentMessage).toHaveBeenCalledOnce();
    expect(realtime.emitMessage).toHaveBeenCalledOnce();
    expect(repository.upsertUnreadMessage).toHaveBeenCalledTimes(2);
    expect(realtime.emitUnreadMessage).toHaveBeenCalledOnce();
    expectBefore(realtime.emitMessage, repository.upsertUnreadMessage);
    expectBefore(repository.upsertUnreadMessage, realtime.emitUnreadMessage, 0, 0);
    expectBefore(repository.upsertUnreadMessage, realtime.emitUnreadMessage, 1, 0);
    expect(media.deleteAttachments).not.toHaveBeenCalled();
  });

  it("preserves a CustomError raised after commit without deleting persisted media", async () => {
    const unreadError = new CustomError("Unread state conflict", 409);
    const { media, repository, realtime, upload } = createDependencies();
    repository.upsertUnreadMessage.mockRejectedValue(unreadError);

    await expect(upload(input())).rejects.toBe(unreadError);

    expect(realtime.emitMessage).toHaveBeenCalledOnce();
    expect(realtime.emitUnreadMessage).not.toHaveBeenCalled();
    expect(media.deleteAttachments).not.toHaveBeenCalled();
  });
});
