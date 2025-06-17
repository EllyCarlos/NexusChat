import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { TypingIndicatorAnimation } from "../ui/TypingIndicatorAnimation";
import { TypingUserList } from "./TypingUserList";

type PropTypes = {
  users: fetchUserChatsResponse['typingUsers']
  isGroupChat: boolean;
};

export const TypingIndicatorWithUserList = ({
  users,
  isGroupChat,
}: PropTypes) => {
  return (
    <div className="flex flex-col gap-1 self-start">
      {users.length > 0 && (
        <div className="w-24 max-xl:w-20">
          <TypingIndicatorAnimation />
        </div>
      )}
      {isGroupChat && <TypingUserList users={users} />}
    </div>
  );
};
