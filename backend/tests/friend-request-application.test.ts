import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "../src/errors/application-error.js";
import { createFriendRequestPreparer } from "../src/modules/friend-requests/application/create-friend-request.js";
import { createFriendRequestLister } from "../src/modules/friend-requests/application/get-friend-requests.js";
import { createFriendRequestHandlerPreparer } from "../src/modules/friend-requests/application/handle-friend-request.js";
import type { FriendRequestNotificationPort } from "../src/modules/friend-requests/contracts/friend-request-notification.port.js";
import type { FriendRequestRealtimePort } from "../src/modules/friend-requests/contracts/friend-request-realtime.port.js";
import type { FriendRequestRepository } from "../src/modules/friend-requests/contracts/friend-request.repository.js";
import type {
  CreatedFriendRequestView,
  DeletedFriendRequest,
  FriendshipParticipants,
  IncomingFriendRequestView,
  PendingFriendRequest,
  PrivateChatView,
  RequestReceiver,
} from "../src/modules/friend-requests/contracts/friend-request.types.js";

const ACTOR_ID = "actor-user";
const ACTOR_USERNAME = "actor";
const RECEIVER_ID = "receiver-user";
const CANONICAL_RECEIVER_ID = "canonical-receiver-user";
const SENDER_ID = "sender-user";
const REQUEST_ID = "request-1";
const STORED_REQUEST_ID = "stored-request-1";
const CHAT_ID = "chat-1";
const createdAt = new Date("2026-08-27T10:00:00.000Z");
const updatedAt = new Date("2026-08-27T10:01:00.000Z");

const actor = {
  id: ACTOR_ID,
  username: ACTOR_USERNAME,
};

const requestReceiver = ({
  id = RECEIVER_ID,
  notificationsEnabled = true,
  fcmToken = "receiver-fcm-token",
}: {
  id?: string;
  notificationsEnabled?: boolean;
  fcmToken?: string | null;
} = {}): RequestReceiver => ({
  id,
  notificationsEnabled,
  fcmToken,
});

const participant = {
  id: ACTOR_ID,
  username: ACTOR_USERNAME,
  avatar: "actor-avatar",
  isOnline: true,
  publicKey: "actor-public-key",
  lastSeen: createdAt,
  verificationBadge: true,
};

const createdRequest: CreatedFriendRequestView = {
  id: REQUEST_ID,
  status: "pending",
  createdAt,
  sender: participant,
};

const pendingRequest = ({
  id = STORED_REQUEST_ID,
  senderId = SENDER_ID,
  receiverId = ACTOR_ID,
}: {
  id?: string;
  senderId?: string;
  receiverId?: string;
} = {}): PendingFriendRequest => ({ id, senderId, receiverId });

const privateChat: PrivateChatView = {
  id: CHAT_ID,
  name: null,
  isGroupChat: false,
  avatar: "chat-avatar",
  adminId: null,
  latestMessageId: null,
  createdAt,
  updatedAt,
  ChatMembers: [],
  UnreadMessages: [],
  latestMessage: null,
};

const friendship = ({
  senderAsUser2 = false,
  notificationsEnabled = true,
  fcmToken = "sender-fcm-token",
}: {
  senderAsUser2?: boolean;
  notificationsEnabled?: boolean;
  fcmToken?: string | null;
} = {}): FriendshipParticipants => {
  const sender = { id: SENDER_ID, notificationsEnabled, fcmToken };
  const receiver = { id: ACTOR_ID, notificationsEnabled: false, fcmToken: null };
  return senderAsUser2
    ? { user1: receiver, user2: sender }
    : { user1: sender, user2: receiver };
};

const deletedRequest = ({
  id = "deleted-request-1",
  notificationsEnabled = true,
  fcmToken = "sender-fcm-token",
}: {
  id?: string;
  notificationsEnabled?: boolean;
  fcmToken?: string | null;
} = {}): DeletedFriendRequest => ({
  id,
  sender: { notificationsEnabled, fcmToken },
});

const createRepository = (): FriendRequestRepository => ({
  listIncomingRequests: vi.fn<FriendRequestRepository["listIncomingRequests"]>()
    .mockResolvedValue([]),
  findRequestReceiver: vi.fn<FriendRequestRepository["findRequestReceiver"]>()
    .mockResolvedValue(requestReceiver()),
  outgoingRequestExists: vi.fn<FriendRequestRepository["outgoingRequestExists"]>()
    .mockResolvedValue(false),
  reverseRequestExists: vi.fn<FriendRequestRepository["reverseRequestExists"]>()
    .mockResolvedValue(false),
  friendshipExists: vi.fn<FriendRequestRepository["friendshipExists"]>()
    .mockResolvedValue(false),
  createRequest: vi.fn<FriendRequestRepository["createRequest"]>()
    .mockResolvedValue(createdRequest),
  findRequestById: vi.fn<FriendRequestRepository["findRequestById"]>()
    .mockResolvedValue(pendingRequest()),
  privateChatExists: vi.fn<FriendRequestRepository["privateChatExists"]>()
    .mockResolvedValue(false),
  createPrivateChat: vi.fn<FriendRequestRepository["createPrivateChat"]>()
    .mockResolvedValue(privateChat),
  createFriendship: vi.fn<FriendRequestRepository["createFriendship"]>()
    .mockResolvedValue(friendship()),
  deleteRequest: vi.fn<FriendRequestRepository["deleteRequest"]>()
    .mockResolvedValue(undefined),
  deleteRequestWithSenderState:
    vi.fn<FriendRequestRepository["deleteRequestWithSenderState"]>()
      .mockResolvedValue(deletedRequest()),
});

const createNotification = () => ({
  notify: vi.fn<FriendRequestNotificationPort["notify"]>(),
});

const createRealtime = () => ({
  emitNewFriendRequest: vi.fn<FriendRequestRealtimePort["emitNewFriendRequest"]>(),
  joinMembersInChat: vi.fn<FriendRequestRealtimePort["joinMembersInChat"]>(),
  emitNewChat: vi.fn<FriendRequestRealtimePort["emitNewChat"]>(),
});

type OrderedMock = {
  mock: {
    invocationCallOrder: number[];
  };
};

const expectCalledBefore = (first: OrderedMock, second: OrderedMock) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const expectApplicationError = async (
  result: Promise<unknown>,
  statusCode: number,
  message: string,
) => {
  const error = await result.catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApplicationError);
  expect(error).toMatchObject({ statusCode, message });
};

describe("friend-request list application", () => {
  it("delegates the authenticated receiver ID and returns the unchanged view array", async () => {
    const repository = createRepository();
    const requests: IncomingFriendRequestView[] = [{
      id: REQUEST_ID,
      senderId: SENDER_ID,
      status: "pending",
      createdAt,
      sender: { ...participant, id: SENDER_ID, username: "sender" },
    }];
    vi.mocked(repository.listIncomingRequests).mockResolvedValue(requests);
    const listRequests = createFriendRequestLister({ repository });

    const result = await listRequests(ACTOR_ID);

    expect(repository.listIncomingRequests).toHaveBeenCalledWith(ACTOR_ID);
    expect(result).toBe(requests);
  });

  it("forwards repository failures unchanged", async () => {
    const repository = createRepository();
    const failure = new Error("list failed");
    vi.mocked(repository.listIncomingRequests).mockRejectedValue(failure);
    const listRequests = createFriendRequestLister({ repository });

    await expect(listRequests(ACTOR_ID)).rejects.toBe(failure);
  });
});

describe("create friend-request application", () => {
  it("rejects a missing receiver before returning a rate-limit continuation", async () => {
    const repository = createRepository();
    const notification = createNotification();
    vi.mocked(repository.findRequestReceiver).mockResolvedValue(null);
    const prepare = createFriendRequestPreparer({ repository, notification });

    await expectApplicationError(
      prepare({ actor, receiverId: RECEIVER_ID }),
      404,
      "Receiver not found",
    );

    expect(repository.findRequestReceiver).toHaveBeenCalledWith(RECEIVER_ID);
    expect(repository.outgoingRequestExists).not.toHaveBeenCalled();
    expect(repository.createRequest).not.toHaveBeenCalled();
    expect(notification.notify).not.toHaveBeenCalled();
  });

  it("rejects self-request after receiver lookup and before returning a continuation", async () => {
    const repository = createRepository();
    const notification = createNotification();
    vi.mocked(repository.findRequestReceiver).mockResolvedValue(requestReceiver({ id: ACTOR_ID }));
    const prepare = createFriendRequestPreparer({ repository, notification });

    await expectApplicationError(
      prepare({ actor, receiverId: ACTOR_ID }),
      400,
      "You cannot send a request to yourself",
    );

    expect(repository.findRequestReceiver).toHaveBeenCalledWith(ACTOR_ID);
    expect(repository.outgoingRequestExists).not.toHaveBeenCalled();
    expect(repository.createRequest).not.toHaveBeenCalled();
  });

  it("returns the fetched rate peer, then preserves requested-ID guards and persist-push-realtime order", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.findRequestReceiver).mockResolvedValue(requestReceiver({
      id: CANONICAL_RECEIVER_ID,
    }));
    const prepare = createFriendRequestPreparer({ repository, notification });

    const prepared = await prepare({ actor, receiverId: RECEIVER_ID });

    expect(prepared.rateLimitPeerId).toBe(CANONICAL_RECEIVER_ID);
    expect(repository.outgoingRequestExists).not.toHaveBeenCalled();

    await prepared.execute(realtime);

    expect(repository.outgoingRequestExists).toHaveBeenCalledWith(ACTOR_ID, RECEIVER_ID);
    expect(repository.reverseRequestExists).toHaveBeenCalledWith(ACTOR_ID, RECEIVER_ID);
    expect(repository.friendshipExists).toHaveBeenCalledWith(ACTOR_ID, RECEIVER_ID);
    expect(repository.createRequest).toHaveBeenCalledWith(ACTOR_ID, RECEIVER_ID);
    expect(notification.notify).toHaveBeenCalledWith({
      recipientToken: "receiver-fcm-token",
      body: "actor sent you a friend request 😃",
    });
    expect(realtime.emitNewFriendRequest).toHaveBeenCalledWith(RECEIVER_ID, createdRequest);
    expectCalledBefore(
      vi.mocked(repository.outgoingRequestExists),
      vi.mocked(repository.reverseRequestExists),
    );
    expectCalledBefore(
      vi.mocked(repository.reverseRequestExists),
      vi.mocked(repository.friendshipExists),
    );
    expectCalledBefore(
      vi.mocked(repository.friendshipExists),
      vi.mocked(repository.createRequest),
    );
    expectCalledBefore(vi.mocked(repository.createRequest), notification.notify);
    expectCalledBefore(notification.notify, realtime.emitNewFriendRequest);
  });

  it("stops at the outgoing duplicate with the exact public error", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.outgoingRequestExists).mockResolvedValue(true);
    const prepared = await createFriendRequestPreparer({ repository, notification })({
      actor,
      receiverId: RECEIVER_ID,
    });

    await expectApplicationError(
      prepared.execute(realtime),
      400,
      "Request is already sent, please wait for them to either accept or reject it",
    );

    expect(repository.reverseRequestExists).not.toHaveBeenCalled();
    expect(repository.friendshipExists).not.toHaveBeenCalled();
    expect(repository.createRequest).not.toHaveBeenCalled();
    expect(realtime.emitNewFriendRequest).not.toHaveBeenCalled();
  });

  it("stops at the reverse duplicate with the exact public error", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.reverseRequestExists).mockResolvedValue(true);
    const prepared = await createFriendRequestPreparer({ repository, notification })({
      actor,
      receiverId: RECEIVER_ID,
    });

    await expectApplicationError(
      prepared.execute(realtime),
      400,
      "They have already sent you a friend request",
    );

    expect(repository.friendshipExists).not.toHaveBeenCalled();
    expect(repository.createRequest).not.toHaveBeenCalled();
    expect(realtime.emitNewFriendRequest).not.toHaveBeenCalled();
  });

  it("stops at existing friendship with the exact public error", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.friendshipExists).mockResolvedValue(true);
    const prepared = await createFriendRequestPreparer({ repository, notification })({
      actor,
      receiverId: RECEIVER_ID,
    });

    await expectApplicationError(
      prepared.execute(realtime),
      400,
      "You are already friends",
    );

    expect(repository.createRequest).not.toHaveBeenCalled();
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.emitNewFriendRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["notifications disabled", requestReceiver({ notificationsEnabled: false })],
    ["missing token", requestReceiver({ fcmToken: null })],
  ])("skips create notification for %s but still emits", async (_case, receiver) => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.findRequestReceiver).mockResolvedValue(receiver);
    const prepared = await createFriendRequestPreparer({ repository, notification })({
      actor,
      receiverId: RECEIVER_ID,
    });

    await prepared.execute(realtime);

    expect(repository.createRequest).toHaveBeenCalledWith(ACTOR_ID, RECEIVER_ID);
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.emitNewFriendRequest).toHaveBeenCalledWith(RECEIVER_ID, createdRequest);
  });

  it("cuts off notification and realtime when persistence fails", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    const failure = new Error("create failed");
    vi.mocked(repository.createRequest).mockRejectedValue(failure);
    const prepared = await createFriendRequestPreparer({ repository, notification })({
      actor,
      receiverId: RECEIVER_ID,
    });

    await expect(prepared.execute(realtime)).rejects.toBe(failure);
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.emitNewFriendRequest).not.toHaveBeenCalled();
  });
});

describe("handle friend-request application", () => {
  it.each([
    ["missing", null],
    ["owned by another receiver", pendingRequest({ receiverId: "other-receiver" })],
  ])("returns the same concealed 404 when the request is %s", async (_case, request) => {
    const repository = createRepository();
    const notification = createNotification();
    vi.mocked(repository.findRequestById).mockResolvedValue(request);
    const prepare = createFriendRequestHandlerPreparer({ repository, notification });

    await expectApplicationError(
      prepare({ actor, requestId: REQUEST_ID, action: "accept" }),
      404,
      "Request not found",
    );

    expect(repository.findRequestById).toHaveBeenCalledWith(REQUEST_ID);
    expect(repository.privateChatExists).not.toHaveBeenCalled();
    expect(repository.deleteRequestWithSenderState).not.toHaveBeenCalled();
  });

  it("preserves separate non-transactional accept operations and their frozen side-effect order", async () => {
    const repository = createRepository();
    const transaction = vi.fn();
    Object.assign(repository, { $transaction: transaction });
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.createFriendship).mockResolvedValue(friendship({ senderAsUser2: true }));
    const prepare = createFriendRequestHandlerPreparer({ repository, notification });

    const prepared = await prepare({ actor, requestId: REQUEST_ID, action: "accept" });

    expect(prepared.rateLimitPeerId).toBe(SENDER_ID);
    expect(repository.privateChatExists).not.toHaveBeenCalled();

    const result = await prepared.execute(realtime);

    expect(result).toBe(STORED_REQUEST_ID);
    expect(repository.privateChatExists).toHaveBeenCalledWith(SENDER_ID, ACTOR_ID);
    expect(repository.createPrivateChat).toHaveBeenCalledWith(SENDER_ID, ACTOR_ID, ACTOR_ID);
    expect(repository.createFriendship).toHaveBeenCalledWith(SENDER_ID, ACTOR_ID);
    expect(notification.notify).toHaveBeenCalledWith({
      recipientToken: "sender-fcm-token",
      body: "actor has accepted your friend request 😃",
    });
    expect(realtime.joinMembersInChat).toHaveBeenCalledWith(
      [SENDER_ID, ACTOR_ID],
      CHAT_ID,
    );
    expect(repository.deleteRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(realtime.emitNewChat).toHaveBeenCalledWith(CHAT_ID, {
      ...privateChat,
      typingUsers: [],
    });
    expect(transaction).not.toHaveBeenCalled();
    expectCalledBefore(
      vi.mocked(repository.privateChatExists),
      vi.mocked(repository.createPrivateChat),
    );
    expectCalledBefore(
      vi.mocked(repository.createPrivateChat),
      vi.mocked(repository.createFriendship),
    );
    expectCalledBefore(vi.mocked(repository.createFriendship), notification.notify);
    expectCalledBefore(notification.notify, realtime.joinMembersInChat);
    expectCalledBefore(realtime.joinMembersInChat, vi.mocked(repository.deleteRequest));
    expectCalledBefore(vi.mocked(repository.deleteRequest), realtime.emitNewChat);
  });

  it("stops accept at the existing-chat guard with the exact public error", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.privateChatExists).mockResolvedValue(true);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "accept",
    });

    await expectApplicationError(
      prepared.execute(realtime),
      400,
      "Your private chat already exists",
    );

    expect(repository.createPrivateChat).not.toHaveBeenCalled();
    expect(repository.createFriendship).not.toHaveBeenCalled();
    expect(repository.deleteRequest).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).not.toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
  });

  it.each([
    ["notifications disabled", friendship({ notificationsEnabled: false })],
    ["missing token", friendship({ fcmToken: null })],
  ])("skips accept notification for %s but preserves later effects", async (_case, friends) => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.createFriendship).mockResolvedValue(friends);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "accept",
    });

    const result = await prepared.execute(realtime);

    expect(result).toBe(STORED_REQUEST_ID);
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).toHaveBeenCalled();
    expect(repository.deleteRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(realtime.emitNewChat).toHaveBeenCalled();
  });

  it("stops accept after private-chat creation fails", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    const failure = new Error("chat create failed");
    vi.mocked(repository.createPrivateChat).mockRejectedValue(failure);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "accept",
    });

    await expect(prepared.execute(realtime)).rejects.toBe(failure);
    expect(repository.createFriendship).not.toHaveBeenCalled();
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).not.toHaveBeenCalled();
    expect(repository.deleteRequest).not.toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
  });

  it("stops accept after friendship creation fails while retaining the chat write", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    const failure = new Error("friendship create failed");
    vi.mocked(repository.createFriendship).mockRejectedValue(failure);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "accept",
    });

    await expect(prepared.execute(realtime)).rejects.toBe(failure);
    expect(repository.createPrivateChat).toHaveBeenCalled();
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).not.toHaveBeenCalled();
    expect(repository.deleteRequest).not.toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
  });

  it("retains chat, friendship, eligible push, and join when accept deletion fails", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    const failure = new Error("request delete failed");
    vi.mocked(repository.deleteRequest).mockRejectedValue(failure);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "accept",
    });

    await expect(prepared.execute(realtime)).rejects.toBe(failure);
    expect(repository.createPrivateChat).toHaveBeenCalled();
    expect(repository.createFriendship).toHaveBeenCalled();
    expect(notification.notify).toHaveBeenCalled();
    expect(realtime.joinMembersInChat).toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
  });

  it("rejects by deleting, notifying exactly, returning the deleted ID, and never using realtime", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "reject",
    });

    const result = await prepared.execute(realtime);

    expect(result).toBe("deleted-request-1");
    expect(repository.deleteRequestWithSenderState).toHaveBeenCalledWith(REQUEST_ID);
    expect(notification.notify).toHaveBeenCalledWith({
      recipientToken: "sender-fcm-token",
      body: "actor has rejected your friend request ☹️",
    });
    expect(repository.privateChatExists).not.toHaveBeenCalled();
    expect(repository.createPrivateChat).not.toHaveBeenCalled();
    expect(repository.createFriendship).not.toHaveBeenCalled();
    expect(repository.deleteRequest).not.toHaveBeenCalled();
    expect(realtime.emitNewFriendRequest).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).not.toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
    expectCalledBefore(
      vi.mocked(repository.deleteRequestWithSenderState),
      notification.notify,
    );
  });

  it.each([
    ["notifications disabled", deletedRequest({ notificationsEnabled: false })],
    ["missing token", deletedRequest({ fcmToken: null })],
  ])("skips reject notification for %s and still returns the deleted ID", async (_case, deleted) => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    vi.mocked(repository.deleteRequestWithSenderState).mockResolvedValue(deleted);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "reject",
    });

    const result = await prepared.execute(realtime);

    expect(result).toBe(deleted.id);
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).not.toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
  });

  it("cuts off reject notification and returns no result when deletion fails", async () => {
    const repository = createRepository();
    const notification = createNotification();
    const realtime = createRealtime();
    const failure = new Error("reject delete failed");
    vi.mocked(repository.deleteRequestWithSenderState).mockRejectedValue(failure);
    const prepared = await createFriendRequestHandlerPreparer({ repository, notification })({
      actor,
      requestId: REQUEST_ID,
      action: "reject",
    });

    await expect(prepared.execute(realtime)).rejects.toBe(failure);
    expect(notification.notify).not.toHaveBeenCalled();
    expect(realtime.joinMembersInChat).not.toHaveBeenCalled();
    expect(realtime.emitNewChat).not.toHaveBeenCalled();
  });
});
