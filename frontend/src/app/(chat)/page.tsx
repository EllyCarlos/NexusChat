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
import { redirect } from "next/navigation";
import { decrypt, SessionPayload } from "@/lib/server/session";

export default async function ChatPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  if (!sessionCookie) {
    redirect("/login");
  }

  let loggedInUserId: string | null = null;
  try {
    const payload: SessionPayload | null = await decrypt(sessionCookie.value);
    if (payload && payload.userId && new Date(payload.expiresAt) > new Date()) {
      loggedInUserId = payload.userId;
    } else {
      redirect("/login");
    }
  } catch (err) {
    console.error("Session decryption failed:", err);
    redirect("/login");
  }

  if (!loggedInUserId) {
    redirect("/login");
  }

  try {
    const [userRes, friendsRes, friendRequestRes, chatsRes, callHistoryRes] = await Promise.allSettled([
      fetchUserInfo({ loggedInUserId }),
      fetchUserFriends({ loggedInUserId }),
      fetchUserFriendRequest({ loggedInUserId }),
      fetchUserChats({ loggedInUserId }),
      fetchUserCallHistory({ loggedInUserId }),
    ]);

    const extract = <T,>(result: PromiseSettledResult<T>): T | null =>
      result.status === "fulfilled" && result.value ? result.value : null;

    const user = extract(userRes);
    const friends = extract(friendsRes);
    const friendRequest = extract(friendRequestRes);
    const chats = extract(chatsRes);
    const callHistory = extract(callHistoryRes);

    if (!user || !friends || !friendRequest || !chats || !callHistory) {
      console.warn("Missing critical data:", {
        user, friends, friendRequest, chats, callHistory,
      });
      return <ServerDownMessage />;
    }

    return (
      <ChatWrapper
        chats={chats}
        friendRequest={friendRequest}
        friends={friends}
        user={user}
        callHistory={callHistory}
      >
        <div className="h-full w-full flex p-4 max-md:p-2 gap-x-6 bg-background select-none">
          <ChatListClientWrapper>
            <ChatListSkeletonWrapper />
          </ChatListClientWrapper>

          <ChatAreaWrapper>
            <div className="flex flex-col gap-y-3 h-full justify-between relative">
              <ChatHeaderWrapper />
              <MessageListSkeletonWrapper loggedInUserId={user.id} />
              <MessageInputAreaWrapper />
            </div>
          </ChatAreaWrapper>

          <ChatDetailsWrapper>
            <ChatDetailsSkeletonWrapper loggedInUser={user} />
          </ChatDetailsWrapper>
        </div>
      </ChatWrapper>
    );
  } catch (err) {
    console.error("Unexpected critical error:", err);
    return <ServerDownMessage />;
  }
}
