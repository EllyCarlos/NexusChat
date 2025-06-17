import { fetchUserFriendsResponse } from "@/lib/server/services/userService"
import { FriendCard } from "../friends/FriendCard"


type PropTypes = {
    friends:fetchUserFriendsResponse[]
    handleAddOrRemoveMember:(newMember: string) => void
    selectedMembers:Array<string>
}

export const FriendList = ({friends,handleAddOrRemoveMember,selectedMembers}:PropTypes) => {
  return (
    <div className="flex flex-wrap gap-3">
        {
            friends.map((friend)=>(
                <FriendCard
                 key={friend.id}
                 friend={friend}
                 handleAddOrRemoveMember={handleAddOrRemoveMember}
                 selectedMembers={selectedMembers}
                />
            ))
        }
    </div>
  )
}
