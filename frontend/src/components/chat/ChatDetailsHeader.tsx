import { DEFAULT_AVATAR } from "@/constants";
import { User } from "@/interfaces/auth.interface";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getChatAvatar, getChatName } from "@/lib/shared/helpers";
import Image from "next/image";
import { useToggleChatUpdateForm } from "../../hooks/useUI/useToggleChatUpdateForm";
import { EndToEndEncryptedText } from "../ui/EndToEndEncryptedText";
import { EditIcon } from "../ui/icons/EditIcon";

type PropTypes = {
  chat: fetchUserChatsResponse;
  loggedInUser: User;
  isAdmin: boolean;
};

export const ChatDetailsHeader = ({ chat, loggedInUser, isAdmin}: PropTypes) => {

  const {toggleChatUpdateForm} = useToggleChatUpdateForm();

  const avatar = getChatAvatar(chat, loggedInUser.id);
  const chatName = getChatName(chat, loggedInUser.id);

  return (
    <div className="flex flex-col gap-y-4 items-center">

      <div className="flex items-center gap-x-2">
        <h5 className="font-medium text-xl text-fluid-h5">Chat Details</h5>
        {isAdmin && (
          <button onClick={toggleChatUpdateForm}>
            <EditIcon />
          </button>
        )}
      </div>

      <Image
        alt="chat avatar"
        className="size-20 object-cover rounded-full"
        src={avatar || DEFAULT_AVATAR}
        width={100}
        height={100}
      />

      <div className="flex flex-col justify-center items-center">
        <h4 className="text-lg font-medium">{chatName}</h4>
        {chat.isGroupChat && (
          <p className="text-secondary-darker">{chat.ChatMembers.length} members</p>
        )}
        {!chat.isGroupChat && <EndToEndEncryptedText />}
      </div>

    </div>
  );
};
