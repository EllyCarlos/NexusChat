import { ChatAreaWrapper } from "@/components/chat/ChatAreaWrapper";
import { ChatDetailsSkeletonWrapper } from "@/components/chat/ChatDetailsSkeletonWrapper";
import { ChatDetailsWrapper } from "@/components/chat/ChatDetailsWrapper";
import { ChatHeaderWrapper } from "@/components/chat/ChatHeaderWrapper";
import { ChatListClientWrapper } from "@/components/chat/ChatListClientWrapper";
import { ChatListSkeletonWrapper } from "@/components/chat/ChatListSkeletonWrapper";
import { ChatWrapper } from "@/components/chat/ChatWrapper";
import { MessageInputAreaWrapper } from "@/components/messages/MessageInputAreaWrapper";
import { MessageListSkeletonWrapper } from "@/components/messages/MessageListSkeletonWrapper";
import { ServerDownMessage } from "@/components/ui/ServerDownMessage";
import { fetchUserCallHistory } from "@/lib/server/services/callService";
import { fetchUserChats, fetchUserFriendRequest, fetchUserFriends, fetchUserInfo } from "@/lib/server/services/userService";
import { cookies } from "next/headers";

export default async function ChatPage() {

  const loggedInUserId = (await cookies()).get("loggedInUserId")?.value as string || '';

  const [user,friends,friendRequest,chats,callHistory] = await Promise.all([
    fetchUserInfo({loggedInUserId}),
    fetchUserFriends({loggedInUserId}),
    fetchUserFriendRequest({loggedInUserId}),
    fetchUserChats({loggedInUserId}),
    fetchUserCallHistory({loggedInUserId})
  ]);


  return (
    (friends && chats && friendRequest && user && callHistory) ? (
    <ChatWrapper 
      chats={chats}
      friendRequest={friendRequest}
      friends={friends}
      user={user}
      callHistory={callHistory}
    >
      <div className="h-full w-full flex p-4 max-md:p-2 gap-x-6 bg-background select-none">
        <ChatListClientWrapper>
          <ChatListSkeletonWrapper/>
        </ChatListClientWrapper>

        <ChatAreaWrapper>
          <div className="flex flex-col gap-y-3 h-full justify-between relative">
            <ChatHeaderWrapper />
            <MessageListSkeletonWrapper loggedInUserId={user.id}/>
            <MessageInputAreaWrapper/>
          </div>
        </ChatAreaWrapper>

        <ChatDetailsWrapper>
          <ChatDetailsSkeletonWrapper loggedInUser={user} />
        </ChatDetailsWrapper>
      </div>
    </ChatWrapper>
  )
  : 
  <ServerDownMessage/>
  );
}
