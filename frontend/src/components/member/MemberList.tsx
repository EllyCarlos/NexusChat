import { ChatMember, fetchUserChatsResponse, fetchUserFriendsResponse } from "@/lib/server/services/userService"
import { MemberCard } from "./MemberCard"

type PropTypes = {
    selectable:boolean
    existingMembers?:fetchUserChatsResponse['ChatMembers'] | []
    members:ChatMember[] | fetchUserFriendsResponse[]
    selectedMembers:Array<string>
    toggleSelection: (memberId: string) => void
}

export const MemberList = ({members,selectedMembers,selectable,existingMembers,toggleSelection}:PropTypes) => {
  return (
    <div className="flex flex-col gap-y-2">
        {
          members.map(member=>(
              <MemberCard
                selectable={selectable}
                key={member.id}
                member={member}
                isSelected={selectedMembers.includes(member.id)}
                toggleSelection={toggleSelection}
                existingMembers={existingMembers}
              />
          ))
        }        
    </div>
  )
}
