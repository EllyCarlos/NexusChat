import { ApplicationError } from "../../../errors/application-error.js";
import type { FriendRequestNotificationPort } from "../contracts/friend-request-notification.port.js";
import type { FriendRequestRealtimePort } from "../contracts/friend-request-realtime.port.js";
import type { FriendRequestRepository } from "../contracts/friend-request.repository.js";
import type { FriendRequestActor } from "../contracts/friend-request.types.js";

type CreateFriendRequestDependencies = {
  repository: Pick<
    FriendRequestRepository,
    | "findRequestReceiver"
    | "outgoingRequestExists"
    | "reverseRequestExists"
    | "friendshipExists"
    | "createRequest"
  >;
  notification: FriendRequestNotificationPort;
};

export type PreparedCreateFriendRequestContinuation = {
  rateLimitPeerId: string;
  execute(realtime: FriendRequestRealtimePort): Promise<void>;
};

const createFriendRequestError = (
  code: string,
  message: string,
  statusCode: number,
) => new ApplicationError({ code, message, statusCode });

export const createFriendRequestPreparer = ({
  repository,
  notification,
}: CreateFriendRequestDependencies) => async ({
  actor,
  receiverId,
}: {
  actor: FriendRequestActor;
  receiverId: string;
}): Promise<PreparedCreateFriendRequestContinuation> => {
  const receiver = await repository.findRequestReceiver(receiverId);

  if (!receiver) {
    throw createFriendRequestError(
      "FRIEND_REQUEST_RECEIVER_NOT_FOUND",
      "Receiver not found",
      404,
    );
  }

  if (actor.id === receiverId) {
    throw createFriendRequestError(
      "FRIEND_REQUEST_SELF_REQUEST",
      "You cannot send a request to yourself",
      400,
    );
  }

  return {
    rateLimitPeerId: receiver.id,
    execute: async (realtime) => {
      if (await repository.outgoingRequestExists(actor.id, receiverId)) {
        throw createFriendRequestError(
          "FRIEND_REQUEST_ALREADY_SENT",
          "Request is already sent, please wait for them to either accept or reject it",
          400,
        );
      }

      if (await repository.reverseRequestExists(actor.id, receiverId)) {
        throw createFriendRequestError(
          "FRIEND_REQUEST_REVERSE_EXISTS",
          "They have already sent you a friend request",
          400,
        );
      }

      if (await repository.friendshipExists(actor.id, receiverId)) {
        throw createFriendRequestError(
          "FRIEND_REQUEST_ALREADY_FRIENDS",
          "You are already friends",
          400,
        );
      }

      const createdRequest = await repository.createRequest(actor.id, receiverId);

      if (receiver.fcmToken && receiver.notificationsEnabled) {
        notification.notify({
          recipientToken: receiver.fcmToken,
          body: `${actor.username} sent you a friend request 😃`,
        });
      }

      await realtime.emitNewFriendRequest(receiverId, createdRequest);
    },
  };
};
