import type {
  CreatedFriendRequestView,
  DeletedFriendRequest,
  FriendshipParticipants,
  IncomingFriendRequestView,
  PendingFriendRequest,
  PrivateChatView,
  RequestReceiver,
} from "./friend-request.types.js";

export interface FriendRequestRepository {
  listIncomingRequests(receiverId: string): Promise<IncomingFriendRequestView[]>;
  findRequestReceiver(receiverId: string): Promise<RequestReceiver | null>;
  outgoingRequestExists(senderId: string, receiverId: string): Promise<boolean>;
  reverseRequestExists(senderId: string, receiverId: string): Promise<boolean>;
  friendshipExists(userAId: string, userBId: string): Promise<boolean>;
  createRequest(
    senderId: string,
    receiverId: string,
  ): Promise<CreatedFriendRequestView>;
  findRequestById(requestId: string): Promise<PendingFriendRequest | null>;
  privateChatExists(senderId: string, receiverId: string): Promise<boolean>;
  createPrivateChat(
    senderId: string,
    receiverId: string,
    viewerId: string,
  ): Promise<PrivateChatView>;
  createFriendship(
    senderId: string,
    receiverId: string,
  ): Promise<FriendshipParticipants>;
  deleteRequest(requestId: string): Promise<void>;
  deleteRequestWithSenderState(requestId: string): Promise<DeletedFriendRequest>;
}
