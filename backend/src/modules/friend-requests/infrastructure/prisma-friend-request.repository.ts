import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { FriendRequestRepository } from "../contracts/friend-request.repository.js";
import type {
  FriendshipParticipant,
  NotificationTarget,
  PendingFriendRequest,
  RequestReceiver,
} from "../contracts/friend-request.types.js";

export const FRIEND_REQUEST_PARTICIPANT_SELECT = {
  id: true,
  username: true,
  avatar: true,
  isOnline: true,
  publicKey: true,
  lastSeen: true,
  verificationBadge: true,
} as const satisfies Prisma.UserSelect;

export const REJECTED_REQUEST_SENDER_SELECT = {
  isOnline: true,
  fcmToken: true,
  notificationsEnabled: true,
} as const satisfies Prisma.UserSelect;

type FriendRequestPrismaClient = Pick<
  PrismaClient,
  "user" | "friendRequest" | "friends" | "chat"
>;

const mapRequestReceiver = (receiver: {
  id: string;
  fcmToken: string | null;
  notificationsEnabled: boolean;
}): RequestReceiver => ({
  id: receiver.id,
  fcmToken: receiver.fcmToken,
  notificationsEnabled: receiver.notificationsEnabled,
});

const mapPendingRequest = (request: {
  id: string;
  senderId: string;
  receiverId: string;
}): PendingFriendRequest => ({
  id: request.id,
  senderId: request.senderId,
  receiverId: request.receiverId,
});

const mapFriendshipParticipant = (participant: {
  id: string;
  fcmToken: string | null;
  notificationsEnabled: boolean;
}): FriendshipParticipant => ({
  id: participant.id,
  fcmToken: participant.fcmToken,
  notificationsEnabled: participant.notificationsEnabled,
});

const mapNotificationTarget = (target: {
  fcmToken: string | null;
  notificationsEnabled: boolean;
}): NotificationTarget => ({
  fcmToken: target.fcmToken,
  notificationsEnabled: target.notificationsEnabled,
});

const privateChatCreateArgs = (
  senderId: string,
  receiverId: string,
  viewerId: string,
) => ({
  data: {
    ChatMembers: {
      create: [
        { user: { connect: { id: senderId } } },
        { user: { connect: { id: receiverId } } },
      ],
    },
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: {
      include: {
        user: {
          select: FRIEND_REQUEST_PARTICIPANT_SELECT,
        },
      },
      omit: {
        chatId: true,
        userId: true,
        id: true,
      },
    },
    UnreadMessages: {
      where: {
        userId: viewerId,
      },
      select: {
        count: true,
        message: {
          select: {
            isTextMessage: true,
            url: true,
            attachments: {
              select: {
                secureUrl: true,
              },
            },
            isPollMessage: true,
            createdAt: true,
            textMessageContent: true,
          },
        },
        sender: {
          select: FRIEND_REQUEST_PARTICIPANT_SELECT,
        },
      },
    },
    latestMessage: {
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
        attachments: {
          select: {
            secureUrl: true,
          },
        },
        poll: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
              },
            },
          },
          omit: {
            id: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
            messageId: true,
          },
        },
      },
    },
  },
} as const satisfies Prisma.ChatCreateArgs);

export const createPrismaFriendRequestRepository = (
  client: FriendRequestPrismaClient,
): FriendRequestRepository => ({
  listIncomingRequests: (receiverId) => client.friendRequest.findMany({
    where: {
      receiverId,
    },
    include: {
      sender: {
        select: FRIEND_REQUEST_PARTICIPANT_SELECT,
      },
    },
    omit: {
      receiverId: true,
      updatedAt: true,
    },
  }),

  findRequestReceiver: async (receiverId) => {
    const receiver = await client.user.findUnique({
      where: { id: receiverId },
    });
    return receiver ? mapRequestReceiver(receiver) : null;
  },

  outgoingRequestExists: async (senderId, receiverId) => Boolean(
    await client.friendRequest.findFirst({
      where: {
        AND: [
          {
            receiverId,
          },
          {
            senderId,
          },
        ],
      },
    }),
  ),

  reverseRequestExists: async (senderId, receiverId) => Boolean(
    await client.friendRequest.findFirst({
      where: {
        AND: [
          {
            senderId: receiverId,
          },
          {
            receiverId: senderId,
          },
        ],
      },
    }),
  ),

  friendshipExists: async (userAId, userBId) => Boolean(
    await client.friends.findFirst({
      where: {
        OR: [
          {
            user1Id: userAId,
            user2Id: userBId,
          },
          {
            user1Id: userBId,
            user2Id: userAId,
          },
        ],
      },
    }),
  ),

  createRequest: (senderId, receiverId) => client.friendRequest.create({
    data: {
      senderId,
      receiverId,
    },
    include: {
      sender: {
        select: FRIEND_REQUEST_PARTICIPANT_SELECT,
      },
    },
    omit: {
      receiverId: true,
      updatedAt: true,
      senderId: true,
    },
  }),

  findRequestById: async (requestId) => {
    const request = await client.friendRequest.findFirst({
      where: {
        id: requestId,
      },
    });
    return request ? mapPendingRequest(request) : null;
  },

  privateChatExists: async (senderId, receiverId) => Boolean(
    await client.chat.findFirst({
      where: {
        isGroupChat: false,
        ChatMembers: {
          every: {
            userId: { in: [senderId, receiverId] },
          },
        },
      },
    }),
  ),

  createPrivateChat: (senderId, receiverId, viewerId) => client.chat.create(
    privateChatCreateArgs(senderId, receiverId, viewerId),
  ),

  createFriendship: async (senderId, receiverId) => {
    const friendship = await client.friends.create({
      data: {
        user1: {
          connect: {
            id: senderId,
          },
        },
        user2: {
          connect: {
            id: receiverId,
          },
        },
      },
      include: {
        user1: true,
        user2: true,
      },
    });
    return {
      user1: mapFriendshipParticipant(friendship.user1),
      user2: mapFriendshipParticipant(friendship.user2),
    };
  },

  deleteRequest: async (requestId) => {
    await client.friendRequest.delete({
      where: {
        id: requestId,
      },
    });
  },

  deleteRequestWithSenderState: async (requestId) => {
    const deletedRequest = await client.friendRequest.delete({
      where: {
        id: requestId,
      },
      include: {
        sender: {
          select: REJECTED_REQUEST_SENDER_SELECT,
        },
      },
    });
    return {
      id: deletedRequest.id,
      sender: mapNotificationTarget(deletedRequest.sender),
    };
  },
});

export const prismaFriendRequestRepository = createPrismaFriendRequestRepository(prisma);
