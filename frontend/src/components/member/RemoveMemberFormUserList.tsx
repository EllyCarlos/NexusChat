import { fetchUserChatsResponse } from "@/lib/server/services/userService"
import { RemoveMemberFromUserListItem } from "./RemoveMemberFormUserListItem"

type PropTypes = {
    selectable:boolean
    members:fetchUserChatsResponse['ChatMembers']
    selectedMembers:string[]
    toggleSelection: (memberId: string) => void
}

export const RemoveMemberFormUserList = ({members,selectedMembers,selectable,toggleSelection}:PropTypes) => {
  return (
    <div className="flex flex-col gap-y-2">
        {
          members.map(member=>(
              <RemoveMemberFromUserListItem
                selectable={selectable}
                key={member.user.id}
                member={member}
                isSelected={selectedMembers.includes(member.user.id)}
                toggleSelection={toggleSelection}
              />
          ))
        }        
    </div>
  )
}
