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
import { redirect } from 'next/navigation';
// IMPORTANT: Ensure this import path is correct and SessionPayload is defined in session.ts
import { decrypt, SessionPayload } from "@/lib/server/session";

export default async function ChatPage() {
    // 1. Robust authentication check: Get the session cookie
    const cookieStore = cookies();
    const sessionCookie = cookieStore.get("session"); // Assuming your session cookie is named "session"

    // If no session cookie, redirect to login.
    if (!sessionCookie) {
        redirect('/login');
    }

    let loggedInUserId: string | null = null;
    try {
        // Attempt to decrypt the session cookie to get the userId
        const payload: SessionPayload | null = await decrypt(sessionCookie.value);
        
        // Ensure payload and userId exist and the session is not expired
        // You might need to adjust payload.expiresAt type based on your SessionPayload definition (e.g., number for timestamp)
        if (payload && payload.userId && new Date(payload.expiresAt) > new Date()) {
            loggedInUserId = payload.userId;
        } else {
            // If payload is invalid or expired, log and redirect
            console.error("Invalid or expired session payload after decryption.");
            redirect('/login');
        }
    } catch (decryptError) {
        // Catch any errors during decryption (e.g., malformed token)
        console.error("Error decrypting session cookie:", decryptError);
        redirect('/login'); // If decryption fails, consider it an invalid session
    }

    // If for any reason loggedInUserId is still null after successful decryption attempt, redirect
    if (!loggedInUserId) {
        console.error("No valid user ID found after session decryption process.");
        redirect('/login');
    }

    // This is the start of the main try block for data fetching
    try { 
        // 2. Fetch data concurrently using Promise.allSettled for robustness.
        // This prevents a single failed fetch from crashing the entire page.
        const [userResponse, friendsResponse, friendRequestResponse, chatsResponse, callHistoryResponse] = await Promise.allSettled([
            fetchUserInfo({ loggedInUserId }),
            fetchUserFriends({ loggedInUserId }),
            fetchUserFriendRequest({ loggedInUserId }),
            fetchUserChats({ loggedInUserId }),
            fetchUserCallHistory({ loggedInUserId })
        ]);

        // Helper function to extract value from fulfilled promises, logging rejections
        const getFulfilledValue = < T, >(result: PromiseSettledResult<T>): T | null => {
            if (result.status === 'fulfilled' && result.value !== null && result.value !== undefined) {
                return result.value;
            } // This closing brace for the 'if' statement was previously missing.
            // Log rejection reason for debugging
            console.error(`Data fetch failed for a promise: ${result.status === 'rejected' ? result.reason : 'Unknown reason'}`);
            return null;
        };

        const user = getFulfilledValue(userResponse);
        const friends = getFulfilledValue(friendsResponse);
        const friendRequest = getFulfilledValue(friendRequestResponse);
        const chats = getFulfilledValue(chatsResponse);
        const callHistory = getFulfilledValue(callHistoryResponse);

        // 3. Granular data validation: Check only essential data
        // If user data, friends, or chats (core functionalities) are missing, display a server error.
        if (!user || !friends || !chats) {
    console.error("Essential chat data (user, friends, or chats) failed to load.");
    return (
        <>
            <ServerDownMessage />
        </>
    );
}
    } catch (error) { // This 'catch' correctly pairs with the 'try' above.
        // Catch any unexpected errors that might occur during the fetching or rendering phases
        console.error("Critical error in ChatPage data fetching:", error);
        return <ServerDownMessage />;
    }
}