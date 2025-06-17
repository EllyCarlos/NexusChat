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

type UserTypingEventReceivePayload = {
  user:{
      id:string
      username:string
      avatar:string
  },
  chatId:string
}

export const useTypingListener = () => {
  const dispatch = useAppDispatch();

  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  const selectedChatDetailsRef = useRef(selectedChatDetails);

  const chats = useAppSelector(selectChats);
  const chatsRef = useRef(chats);

  useEffect(()=>{
    chatsRef.current = chats;
  },[chats])

  useEffect(() => {
    selectedChatDetailsRef.current = selectedChatDetails;
  }, [selectedChatDetails]);

  useSocketEvent(Event.USER_TYPING,({chatId,user}: UserTypingEventReceivePayload) => {

      if (selectedChatDetailsRef.current) {

        const isTypinginOpennedChat = chatId === selectedChatDetailsRef.current.id;

        if (isTypinginOpennedChat) {

          const isUserAlreadyTyping = selectedChatDetailsRef.current.typingUsers.some(typingUser => typingUser.id == user.id);

          if (!isUserAlreadyTyping) {
            dispatch(updateUserTyping(user));
            setTimeout(() => {
              dispatch(removeUserTyping(user.id));
            }, 1000);
          }

        }
        
      }
      
      else {

        let isNewUserPushedInTypingArray: boolean = false;
        
        const chat = chatsRef.current.find(draft => draft.id === chatId);
        if (chat) {
          const isUserAlreadyTyping = chat.typingUsers.some(typingUser => typingUser.id === user.id);
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
