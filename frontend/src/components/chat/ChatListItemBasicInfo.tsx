import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import {
  formatRelativeTime,
  getActiveMembersInChat,
  getChatName,
  getOtherMemberOfPrivateChat
} from "@/lib/shared/helpers";
import { ActiveDot } from "../ui/ActiveDot";
import { VerificationBadgeIcon } from "../ui/icons/VerificationBadgeIcon";

type PropTypes = {
  chat: fetchUserChatsResponse;
};

export const ChatListItemBasicInfo = ({ chat }: PropTypes) => {
  
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string;

  const renderOnlineStatus = () => {
    if (chat.isGroupChat) {
      const otherActiveMembers = getActiveMembersInChat(chat,loggedInUserId);
      if (otherActiveMembers?.length) {
        return (
          <div className="text-sm text-secondary-darker flex items-center gap-x-1 ml-1">
            <ActiveDot />
            <p>{otherActiveMembers?.length}</p>
          </div>
        );
      }
    } else {
      const otherMember = getOtherMemberOfPrivateChat(chat, loggedInUserId);
      return otherMember.user.isOnline ? <ActiveDot /> : null;
    }
  };

  const time = formatRelativeTime(
    JSON.stringify(
      (chat.UnreadMessages.length>0 && chat.UnreadMessages[0]?.message?.createdAt) ||
        chat.latestMessage?.createdAt ||
        chat.createdAt
    )
  );

  const chatName = getChatName(chat, loggedInUserId) as string;

  return (
    <div className="flex items-center gap-x-2 justify-between w-full shrink-0">
      <div className="flex items-center gap-x-1">
        <p className="font-medium break-words">{chatName}</p>
        <span>{!chat.isGroupChat && getOtherMemberOfPrivateChat(chat, loggedInUserId).user.verificationBadge && <VerificationBadgeIcon />}</span>
        <div>{renderOnlineStatus()}</div>
      </div>
      <p className="text-sm text-secondary-darker">{time}</p>
    </div>
  );
};
