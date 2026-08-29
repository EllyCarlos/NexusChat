import { ApplicationError } from "../../../errors/application-error.js";
import type { ChatRealtimePort } from "../contracts/chat-realtime.port.js";
import type { ChatRepository } from "../contracts/chat.repository.js";
import type {
  AuthorizedChatMutationContext,
  DeletedChatPayload,
  RemovedMembersPayload,
} from "../contracts/chat.types.js";

type RemoveChatMembersDependencies = {
  repository: Pick<
    ChatRepository,
    "listMemberIdsForRemoval" | "updateAdmin" | "deleteMembers"
  >;
  realtime: Pick<
    ChatRealtimePort,
    "disconnectMembers" | "emitDeleteChat" | "emitMembersRemoved"
  >;
};

export interface RemoveChatMembersInput {
  chatId: string;
  authorizedChat: AuthorizedChatMutationContext;
  memberIds: string[];
}

export const createChatMemberRemover = ({
  repository,
  realtime,
}: RemoveChatMembersDependencies) => async ({
  chatId,
  authorizedChat,
  memberIds,
}: RemoveChatMembersInput): Promise<RemovedMembersPayload> => {
  const existingMemberIds = await repository.listMemberIdsForRemoval(chatId);

  if (existingMemberIds.length === 3) {
    throw new ApplicationError({
      code: "CHAT_MINIMUM_MEMBERS_REQUIRED",
      message: "Minimum 3 members are required in a group chat",
      statusCode: 400,
    });
  }

  const missingMemberIds = memberIds.filter(
    (memberId) => !existingMemberIds.includes(memberId),
  );

  if (missingMemberIds.length) {
    throw new ApplicationError({
      code: "CHAT_REMOVED_MEMBERS_NOT_FOUND",
      message: "Provided members to be removed dosen't exists in chat",
      statusCode: 404,
    });
  }

  let departingAdminId: string | null = null;
  for (const memberId of memberIds) {
    if (memberId === authorizedChat.adminId) {
      departingAdminId = memberId;
      break;
    }
  }

  if (departingAdminId) {
    let nextAdminId: string | null = null;
    for (const memberId of existingMemberIds) {
      if (memberId !== departingAdminId && !memberIds.includes(memberId)) {
        nextAdminId = memberId;
        break;
      }
    }

    if (nextAdminId) {
      await repository.updateAdmin(chatId, nextAdminId);
    }
  }

  await repository.deleteMembers(chatId, memberIds);

  realtime.disconnectMembers(memberIds, chatId);

  const deletedChatPayload: DeletedChatPayload = {
    chatId,
  };
  realtime.emitDeleteChat(memberIds, deletedChatPayload);

  const remainingMemberIds = existingMemberIds.filter(
    (memberId) => !memberIds.includes(memberId),
  );
  const payload: RemovedMembersPayload = {
    chatId,
    membersId: memberIds,
  };
  realtime.emitMembersRemoved(remainingMemberIds, payload);

  return payload;
};
