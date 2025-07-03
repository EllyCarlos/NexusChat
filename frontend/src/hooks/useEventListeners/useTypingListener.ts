import { Event } from "@/interfaces/events.interface";
import {
  removeUserTyping,
  removeUserTypingFromChats,
  selectChats,
  selectSelectedChatDetails,
  updateUserTyping,
  updateUserTypingInChats,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useEffect, useRef } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";

// Re-using BasicUserInfo from where it's defined (e.g., useChatListItemClick.ts)
// Make sure this import path is correct based on your project structure.
import { BasicUserInfo, Chat } from "../useChat/useChatListItemClick"; 


type UserTypingEventReceivePayload = {
  user: BasicUserInfo; // Explicitly use BasicUserInfo type here
  chatId: string;
};

export const useTypingListener = () => {
  const dispatch = useAppDispatch();

  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  const selectedChatDetailsRef = useRef(selectedChatDetails);

  const chats = useAppSelector(selectChats);
  const chatsRef = useRef(chats);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    selectedChatDetailsRef.current = selectedChatDetails;
  }, [selectedChatDetails]);

  useSocketEvent(Event.USER_TYPING, ({ chatId, user }: UserTypingEventReceivePayload) => {
      if (selectedChatDetailsRef.current) {
        const isTypinginOpennedChat = chatId === selectedChatDetailsRef.current.id;

        if (isTypinginOpennedChat) {
          // Explicitly type typingUser as BasicUserInfo
          const isUserAlreadyTyping = selectedChatDetailsRef.current.typingUsers.some((typingUser: BasicUserInfo) => typingUser.id == user.id);

          if (!isUserAlreadyTyping) {
            dispatch(updateUserTyping(user));
            setTimeout(() => {
              dispatch(removeUserTyping(user.id));
            }, 1000);
          }
        }
      } else {
        let isNewUserPushedInTypingArray: boolean = false;
        
        // Explicitly type 'draft' as Chat
        const chat = chatsRef.current.find((draft: Chat) => draft.id === chatId);
        if (chat) {
          // Explicitly type typingUser as BasicUserInfo
          const isUserAlreadyTyping = chat.typingUsers.some((typingUser: BasicUserInfo) => typingUser.id === user.id);
          if (!isUserAlreadyTyping) {
            dispatch(updateUserTypingInChats({chatId,user}))
            isNewUserPushedInTypingArray = true;
          }
        }

        if (isNewUserPushedInTypingArray) {
          setTimeout(() => {
            dispatch(removeUserTypingFromChats({chatId,userId:user.id}));
          }, 1000);
        }
      }
    }
  );
};