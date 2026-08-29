import type { ChatReadRepository } from "../contracts/chat-read.repository.js";
import type { UserChatView } from "../contracts/read-query.types.js";

export const createUserChatLister = ({
  repository,
}: {
  repository: ChatReadRepository;
}) => async (userId: string): Promise<UserChatView[]> => {
  const chats = await repository.listChatsForUser(userId);
  return chats.map((chat) => ({
    ...chat,
    typingUsers: [],
  }));
};
