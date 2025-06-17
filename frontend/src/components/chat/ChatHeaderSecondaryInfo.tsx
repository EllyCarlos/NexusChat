import {
  ChatMember,
  fetchUserChatsResponse,
} from "@/lib/server/services/userService";
import {
  formatRelativeTime,
  getActiveMembersInChat
} from "@/lib/shared/helpers";
import { ActiveDot } from "../ui/ActiveDot";

type PropTypes = {
  selectedChatDetails: fetchUserChatsResponse;
  otherMemberOfPrivateChat: ChatMember;
  loggedInUserId: string;
};

export const ChatHeaderSecondaryInfo = ({
  selectedChatDetails,
  otherMemberOfPrivateChat,
  loggedInUserId,
}: PropTypes) => {

  const activeMemberInGroupChat = getActiveMembersInChat(
    selectedChatDetails,
    loggedInUserId
  );

  if (!selectedChatDetails.isGroupChat) {
    return (
      <div className="flex items-center gap-x-2">
        {
          activeMemberInGroupChat.length == 0 ? (
            <p className="text-secondary-darker max-sm:text-sm">
              last seen{" "}
              {formatRelativeTime(
                JSON.stringify(otherMemberOfPrivateChat?.lastSeen)
              )}
            </p>
          ):(
          <div className="flex items-center gap-x-2">
            <ActiveDot />
            <p className="text-secondary-darker max-sm:text-sm">Active</p>
          </div>
          )
        }
      </div>
    );
  } else {
    return (
      <div className="flex items-center gap-x-2">
        <p className="text-secondary-darker max-sm:text-sm">
          {selectedChatDetails.ChatMembers.length - 1} Members
        </p>
        <div className="flex items-center gap-x-2">
          <ActiveDot />
          <span className="text-secondary-darker max-sm:text-sm">
            {`${activeMemberInGroupChat.length} online`}
          </span>
        </div>
      </div>
    );
  }
};
