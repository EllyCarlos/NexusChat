import { fetchUserFriendRequestResponse } from "@/lib/server/services/userService";
import { FriendRequestItem } from "./FriendRequestItem";

type PropTypes = {
    users:fetchUserFriendRequestResponse[];
    friendRequestHandler:(requestId: fetchUserFriendRequestResponse['id'], action: "accept" | "reject") => void
    isLoading: boolean
}
export const FriendRequestList = ({users,friendRequestHandler,isLoading}:PropTypes) => {
  return (
    <div className="flex flex-col gap-y-3">
        {
            users.map(user=>(
                <FriendRequestItem key={user.id} user={user} friendRequestHandler={friendRequestHandler}  isLoading={isLoading}/>
            ))
        }
    </div>
  )
}
