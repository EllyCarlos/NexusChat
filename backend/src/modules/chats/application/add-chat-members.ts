import { ApplicationError } from "../../../errors/application-error.js";
import type { ChatRealtimePort } from "../contracts/chat-realtime.port.js";
import type { ChatRepository } from "../contracts/chat.repository.js";
import type {
  AddedMembersPayload,
  AuthorizedChatMutationContext,
} from "../contracts/chat.types.js";

type AddChatMembersDependencies = {
  repository: Pick<
    ChatRepository,
    | "findExistingRequestedMemberUsernames"
    | "listMemberIdsForAddition"
    | "addMembers"
    | "findMemberPublicDetails"
    | "findChatForAddedMemberPayload"
  >;
  realtime: Pick<
    ChatRealtimePort,
    "joinMembers" | "emitNewChatToMembers" | "emitMembersAdded"
  >;
};

export interface AddChatMembersInput {
  chatId: string;
  authorizedChat: AuthorizedChatMutationContext;
  memberIds: string[];
}

export const createChatMemberAdder = ({
  repository,
  realtime,
}: AddChatMembersDependencies) => async ({
  chatId,
  authorizedChat,
  memberIds,
}: AddChatMembersInput): Promise<AddedMembersPayload> => {
  const existingUsernames = await repository.findExistingRequestedMemberUsernames(
    chatId,
    memberIds,
  );

  if (existingUsernames.length) {
    throw new ApplicationError({
      code: "CHAT_MEMBERS_ALREADY_EXIST",
      message: `${existingUsernames} already exists in members of this chat`,
      statusCode: 400,
    });
  }

  const oldMemberIds = await repository.listMemberIdsForAddition(chatId);

  await repository.addMembers(chatId, memberIds);

  const newMemberDetails = await repository.findMemberPublicDetails(memberIds);
  const updatedChat = await repository.findChatForAddedMemberPayload(
    authorizedChat.id,
  );

  const newChatPayload = {
    ...(updatedChat ?? {}),
    typingUsers: [],
    UnreadMessages: [],
  } as Parameters<ChatRealtimePort["emitNewChatToMembers"]>[1];

  realtime.joinMembers(memberIds, authorizedChat.id);
  realtime.emitNewChatToMembers(memberIds, newChatPayload);

  const payload: AddedMembersPayload = {
    chatId: authorizedChat.id,
    members: newMemberDetails,
  };
  realtime.emitMembersAdded(oldMemberIds, payload);

  return payload;
};
