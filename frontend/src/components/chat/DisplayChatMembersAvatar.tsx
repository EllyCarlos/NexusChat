
import { DEFAULT_AVATAR } from "@/constants";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import Image from "next/image";

type PropTypes = {
  members: fetchUserChatsResponse['ChatMembers']
};

export const DisplayChatMembersAvatar = ({ members }: PropTypes) => {

  const top4Members = members.slice(0, 4);
  const remainingMembers = members.length - 4;

  return (
    <div className="flex items-center">
      {top4Members.map(member => (
        <Image
          className="size-8 rounded-full object-cover shrink-0"
          key={member.user.id}
          src={member.user.avatar || DEFAULT_AVATAR}
          width={100}
          height={100}
          alt={`${member.user.username} avatar`}
        />
      ))}
      {remainingMembers > 0 && (
        <p className="w-8 h-8 rounded-full bg-secondary-dark flex justify-center items-center">
          +{remainingMembers}
        </p>
      )}
    </div>
  );
};
