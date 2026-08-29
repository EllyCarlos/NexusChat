import { ApplicationError } from "../../../errors/application-error.js";
import type { FriendRequestNotificationPort } from "../contracts/friend-request-notification.port.js";
import type { FriendRequestRealtimePort } from "../contracts/friend-request-realtime.port.js";
import type { FriendRequestRepository } from "../contracts/friend-request.repository.js";
import type {
  AcceptedPrivateChatView,
  FriendRequestAction,
  FriendRequestActor,
} from "../contracts/friend-request.types.js";

type HandleFriendRequestDependencies = {
  repository: Pick<
    FriendRequestRepository,
    | "findRequestById"
    | "privateChatExists"
    | "createPrivateChat"
    | "createFriendship"
    | "deleteRequest"
    | "deleteRequestWithSenderState"
  >;
  notification: FriendRequestNotificationPort;
};

export type PreparedHandleFriendRequestContinuation = {
  rateLimitPeerId: string;
  execute(realtime: FriendRequestRealtimePort): Promise<string>;
};

const handleFriendRequestError = (
  code: string,
  message: string,
  statusCode: number,
) => new ApplicationError({ code, message, statusCode });

export const createFriendRequestHandlerPreparer = ({
  repository,
  notification,
}: HandleFriendRequestDependencies) => async ({
  actor,
  requestId,
  action,
}: {
  actor: FriendRequestActor;
  requestId: string;
  action: FriendRequestAction;
}): Promise<PreparedHandleFriendRequestContinuation> => {
  const request = await repository.findRequestById(requestId);

  if (!request || request.receiverId !== actor.id) {
    throw handleFriendRequestError(
      "FRIEND_REQUEST_NOT_FOUND",
      "Request not found",
      404,
    );
  }

  return {
    rateLimitPeerId: request.senderId,
    execute: async (realtime) => {
      if (action === "accept") {
        if (await repository.privateChatExists(request.senderId, request.receiverId)) {
          throw handleFriendRequestError(
            "FRIEND_REQUEST_PRIVATE_CHAT_EXISTS",
            "Your private chat already exists",
            400,
          );
        }

        const newChat = await repository.createPrivateChat(
          request.senderId,
          request.receiverId,
          actor.id,
        );
        const friendship = await repository.createFriendship(
          request.senderId,
          request.receiverId,
        );
        const sender = friendship.user1.id === request.senderId
          ? friendship.user1
          : friendship.user2;

        if (sender.notificationsEnabled && sender.fcmToken) {
          notification.notify({
            recipientToken: sender.fcmToken,
            body: `${actor.username} has accepted your friend request 😃`,
          });
        }

        realtime.joinMembersInChat(
          [request.senderId, request.receiverId],
          newChat.id,
        );
        await repository.deleteRequest(requestId);

        const acceptedChat: AcceptedPrivateChatView = {
          ...newChat,
          typingUsers: [],
        };
        realtime.emitNewChat(newChat.id, acceptedChat);

        return request.id;
      }

      const deletedRequest = await repository.deleteRequestWithSenderState(requestId);

      if (deletedRequest.sender.fcmToken && deletedRequest.sender.notificationsEnabled) {
        notification.notify({
          recipientToken: deletedRequest.sender.fcmToken,
          body: `${actor.username} has rejected your friend request ☹️`,
        });
      }

      return deletedRequest.id;
    },
  };
};
