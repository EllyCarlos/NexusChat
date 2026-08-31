import { DEFAULT_AVATAR } from "../../constants/file.constant.js";
import {
  createChatMemberAdder,
  type AddChatMembersInput,
} from "./application/add-chat-members.js";
import {
  createGroupChatCreator,
} from "./application/create-group-chat.js";
import {
  createChatMemberRemover,
  type RemoveChatMembersInput,
} from "./application/remove-chat-members.js";
import {
  createGroupChatUpdater,
} from "./application/update-group-chat.js";
import { createCloudinaryChatAvatarMediaAdapter } from "./infrastructure/cloudinary-chat-avatar-media.adapter.js";
import { prismaChatRepository } from "./infrastructure/prisma-chat.repository.js";
import {
  createSocketChatRealtimeAdapter,
  type SocketConnectionDirectoryResolver,
  type SocketServerResolver,
} from "./infrastructure/socket-chat-realtime.adapter.js";

type ChatMutationComposition = {
  resolveConnectionDirectory: SocketConnectionDirectoryResolver;
  resolveSocketServer: SocketServerResolver;
};

type ChatAvatarMutationComposition = ChatMutationComposition & {
  avatarFile?: Express.Multer.File;
};

export const createGroupChatOperation = ({
  resolveConnectionDirectory,
  resolveSocketServer,
  avatarFile,
}: ChatAvatarMutationComposition) => createGroupChatCreator({
  repository: prismaChatRepository,
  realtime: createSocketChatRealtimeAdapter(resolveSocketServer, resolveConnectionDirectory),
  defaultAvatar: DEFAULT_AVATAR,
  ...(avatarFile
    ? { avatarMedia: createCloudinaryChatAvatarMediaAdapter(avatarFile) }
    : {}),
});

export const createAddChatMembersOperation = ({
  resolveConnectionDirectory,
  resolveSocketServer,
}: ChatMutationComposition) => {
  const realtime = createSocketChatRealtimeAdapter(resolveSocketServer, resolveConnectionDirectory);
  const addMembers = createChatMemberAdder({
    repository: prismaChatRepository,
    realtime,
  });

  return (input: AddChatMembersInput) => addMembers(input);
};

export const createRemoveChatMembersOperation = ({
  resolveConnectionDirectory,
  resolveSocketServer,
}: ChatMutationComposition) => {
  const realtime = createSocketChatRealtimeAdapter(resolveSocketServer, resolveConnectionDirectory);
  const removeMembers = createChatMemberRemover({
    repository: prismaChatRepository,
    realtime,
  });

  return (input: RemoveChatMembersInput) => removeMembers(input);
};

export const createUpdateGroupChatOperation = ({
  resolveConnectionDirectory,
  resolveSocketServer,
  avatarFile,
}: ChatAvatarMutationComposition) => createGroupChatUpdater({
  repository: prismaChatRepository,
  realtime: createSocketChatRealtimeAdapter(resolveSocketServer, resolveConnectionDirectory),
  ...(avatarFile
    ? { avatarMedia: createCloudinaryChatAvatarMediaAdapter(avatarFile) }
    : {}),
});
