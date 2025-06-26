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
import { redirect } from 'next/navigation'; // Import redirect

export default async function ChatPage() {

    // 1. More robust authentication check
    const cookieStore = await cookies();
const loggedInUserId = cookieStore.get("loggedInUserId")?.value;

    if (!loggedInUserId) {
        // If no user ID, redirect to the login page.
        redirect('/login'); 
    }

    try {
        // 2. Fetch data concurrently
        const [user, friends, friendRequest, chats, callHistory] = await Promise.all([
            fetchUserInfo({ loggedInUserId }),
            fetchUserFriends({ loggedInUserId }),
            fetchUserFriendRequest({ loggedInUserId }),
            fetchUserChats({ loggedInUserId }),
            fetchUserCallHistory({ loggedInUserId }) // This is where the original Prisma error likely occurred
        ]);

        // 3. More granular check. The most critical data is the user and friends/chats.
        // Call history or friend requests being empty shouldn't break the whole page.
        if (!user || !friends || !chats || !friendRequest) {
            // This indicates a more serious problem than just empty data.
            return <ServerDownMessage message="Failed to load critical user data. Please try again later." />;
        }

        return (
            <ChatWrapper
                // Pass all data, even if it's an empty array (e.g., callHistory).
                // Let child components decide how to render empty states.
                chats={chats}
                friendRequest={friendRequest}
                friends={friends}
                user={user}
                callHistory={callHistory || []} // Ensure it's at least an empty array
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

    } catch (error) {
        // 4. Catch errors from Promise.all (e.g., database connection issues)
        console.error("Failed to fetch chat page data:", error);
        // This will be caught by the nearest error.js boundary.
        // Or you can return a specific error component here.
        return <ServerDownMessage message="A server error occurred while loading your data."/>;
    }
}