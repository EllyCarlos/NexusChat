import {
    fetchUserChatsResponse
} from "@/lib/server/services/userService";
import Image from "next/image";
  
  type PropTypes = {
    selectable: boolean;
    member: fetchUserChatsResponse['ChatMembers'][0];
    isSelected?: boolean;
    toggleSelection: (memberId: string) => void;
  };
  
  export const RemoveMemberFromUserListItem = ({
    member,
    isSelected = false,
    selectable,
    toggleSelection,
  }: PropTypes) => {
  
    const handleMemberClick = () => {
      if (selectable) {
        toggleSelection(member.user.id);
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
            src={member.user.avatar}
            height={100}
            width={100}
            className="size-7"
            alt={member.user.username}
          />
          <p>{member.user.username}</p>
        </div>
      </div>
    );
  };
  