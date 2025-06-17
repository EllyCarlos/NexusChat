import { fetchUserFriendRequestResponse, FetchUserInfoResponse } from "@/lib/server/services/userService"
import { UserItem } from "./UserItem"

type PropTypes = {
    users:Array<Pick<FetchUserInfoResponse , "id" | 'name' | "username" | 'avatar'>>
    friends:fetchUserFriendRequestResponse[]
    loggedInUserId: string
    sendFriendRequest:(receiverId:string)=>void
}
export const UserList = ({users,friends,loggedInUserId,sendFriendRequest}:PropTypes) => {
  return (
    <div className="flex flex-col gap-y-3">
        {
            users.map((user,index)=>(
                <UserItem 
                  key={index} 
                  user={user} 
                  loggedInUserId={loggedInUserId}
                  isFriendAlready={friends.some(friend=>friend.id===user.id)}
                  sendFriendRequest={sendFriendRequest} 
                />
            ))
        }
    </div>
  )
}
