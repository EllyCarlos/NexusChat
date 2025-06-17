import { ChatMember, fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getChatName } from "@/lib/shared/helpers";
import { VerificationBadgeIcon } from "../ui/icons/VerificationBadgeIcon";

type PropTypes = {
  selectedChatDetails: fetchUserChatsResponse;
  loggedInUserId: string;
  otherMemberOfPrivateChat: ChatMember;
};

export const ChatHeaderBasicInfo = ({
  loggedInUserId,
  otherMemberOfPrivateChat,
  selectedChatDetails,
}: PropTypes) => {

  const chatName = getChatName(selectedChatDetails, loggedInUserId) as string;

  return (
    <div className="flex items-center gap-x-1">
      <h4 className="font-medium text-4xl max-sm:text-2xl">{chatName}</h4>
      {!selectedChatDetails.isGroupChat &&
        otherMemberOfPrivateChat?.verificationBadge && (
          <span>
            <VerificationBadgeIcon />
          </span>
        )}
    </div>
  );
};
