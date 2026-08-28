import { DEFAULT_AVATAR } from "../../constants/file.constant.js";
import {
  createChatMemberAdder,
  type AddChatMembersInput,
} from "./application/add-chat-members.js";
import {
  createGroupChatCreator,
  type CreateGroupChatInput,
} from "./application/create-group-chat.js";
import {
  createChatMemberRemover,
  type RemoveChatMembersInput,
} from "./application/remove-chat-members.js";
import {
  createGroupChatUpdater,
  type UpdateGroupChatInput,
} from "./application/update-group-chat.js";
import { createCloudinaryChatAvatarMediaAdapter } from "./infrastructure/cloudinary-chat-avatar-media.adapter.js";
import { prismaChatRepository } from "./infrastructure/prisma-chat.repository.js";
import {
  createSocketChatRealtimeAdapter,
  type SocketServerResolver,
} from "./infrastructure/socket-chat-realtime.adapter.js";

type ChatMutationComposition = {
  resolveSocketServer: SocketServerResolver;
};

type ChatAvatarMutationComposition = ChatMutationComposition & {
  avatarFile?: Express.Multer.File;
};

export const createGroupChatOperation = ({
  resolveSocketServer,
  avatarFile,
}: ChatAvatarMutationComposition) => createGroupChatCreator({
  repository: prismaChatRepository,
  realtime: createSocketChatRealtimeAdapter(resolveSocketServer),
  defaultAvatar: DEFAULT_AVATAR,
  ...(avatarFile
    ? { avatarMedia: createCloudinaryChatAvatarMediaAdapter(avatarFile) }
    : {}),
});

export const createAddChatMembersOperation = ({
  resolveSocketServer,
}: ChatMutationComposition) => {
  const realtime = createSocketChatRealtimeAdapter(resolveSocketServer);
  const addMembers = createChatMemberAdder({
    repository: prismaChatRepository,
    realtime,
  });

  return (input: AddChatMembersInput) => addMembers(input);
};

export const createRemoveChatMembersOperation = ({
  resolveSocketServer,
}: ChatMutationComposition) => {
  const realtime = createSocketChatRealtimeAdapter(resolveSocketServer);
  const removeMembers = createChatMemberRemover({
    repository: prismaChatRepository,
    realtime,
  });

  return (input: RemoveChatMembersInput) => removeMembers(input);
};

export const createUpdateGroupChatOperation = ({
  resolveSocketServer,
  avatarFile,
}: ChatAvatarMutationComposition) => createGroupChatUpdater({
  repository: prismaChatRepository,
  realtime: createSocketChatRealtimeAdapter(resolveSocketServer),
  ...(avatarFile
    ? { avatarMedia: createCloudinaryChatAvatarMediaAdapter(avatarFile) }
    : {}),
});

export type {
  AddChatMembersInput,
  CreateGroupChatInput,
  RemoveChatMembersInput,
  UpdateGroupChatInput,
};
