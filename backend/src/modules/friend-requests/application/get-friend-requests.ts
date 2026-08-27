import type { FriendRequestRepository } from "../contracts/friend-request.repository.js";
import type { IncomingFriendRequestView } from "../contracts/friend-request.types.js";

type FriendRequestListerDependencies = {
  repository: Pick<FriendRequestRepository, "listIncomingRequests">;
};

export const createFriendRequestLister = ({
  repository,
}: FriendRequestListerDependencies) => async (
  receiverId: string,
): Promise<IncomingFriendRequestView[]> => repository.listIncomingRequests(receiverId);
