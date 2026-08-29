import { createFriendRequestPreparer } from "./application/create-friend-request.js";
import { createFriendRequestLister } from "./application/get-friend-requests.js";
import { createFriendRequestHandlerPreparer } from "./application/handle-friend-request.js";
import { prismaFriendRequestRepository } from "./infrastructure/prisma-friend-request.repository.js";
import { pushFriendRequestNotificationAdapter } from "./infrastructure/push-friend-request-notification.adapter.js";
import { createSocketFriendRequestRealtimeAdapter } from "./infrastructure/socket-friend-request-realtime.adapter.js";

export const getFriendRequests = createFriendRequestLister({
  repository: prismaFriendRequestRepository,
});

export const prepareCreateFriendRequest = createFriendRequestPreparer({
  repository: prismaFriendRequestRepository,
  notification: pushFriendRequestNotificationAdapter,
});

export const prepareHandleFriendRequest = createFriendRequestHandlerPreparer({
  repository: prismaFriendRequestRepository,
  notification: pushFriendRequestNotificationAdapter,
});

export const createFriendRequestRealtime = createSocketFriendRequestRealtimeAdapter;
