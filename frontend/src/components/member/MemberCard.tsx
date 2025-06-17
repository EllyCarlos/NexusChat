import {
  ChatMember,
  fetchUserChatsResponse,
} from "@/lib/server/services/userService";
import Image from "next/image";

type PropTypes = {
  selectable: boolean;
  member: ChatMember;
  isSelected?: boolean;
  toggleSelection: (memberId: string) => void;
  existingMembers?: fetchUserChatsResponse["ChatMembers"] | [];
};

export const MemberCard = ({
  member,
  isSelected = false,
  selectable,
  toggleSelection,
  existingMembers,
}: PropTypes) => {

  const isMemberAlready = existingMembers?.some(
    ({ user: { id } }) => id === member.id
  );

  const handleMemberClick = () => {
    if (isMemberAlready) {
      return;
    }
    if (selectable) {
      toggleSelection(member.id);
    }
  };

  return (
    <div
      onClick={handleMemberClick}
      className={`flex justify-between rounded-md cursor-pointer ${
        isSelected
          ? "bg-primary hover:bg-primary-dark"
          : "hover:bg-secondary-darker"
      } p-2 shadow-sm`}
    >
      <div className="flex gap-x-2 items-center">
        <Image
          src={member.avatar}
          height={100}
          width={100}
          className="size-7"
          alt={member.username}
        />
        <p>{member.username}</p>
      </div>

      {isMemberAlready && <span>Member</span>}
    </div>
  );
};
