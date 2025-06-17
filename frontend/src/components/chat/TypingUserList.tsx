import { fetchUserChatsResponse } from "@/lib/server/services/userService"
import { TypingCard } from "../ui/TypingCard"

type PropTypes = {
    users:fetchUserChatsResponse['typingUsers']
}

export const TypingUserList = ({users}:PropTypes) => {
  return (
    <div className="flex flex-col gap-y-2">
        {
            users.map(user=>(
              <TypingCard key={user.id} avatar={user.avatar} username={user.username}/>
            ))
        }
    </div>
  )
}
