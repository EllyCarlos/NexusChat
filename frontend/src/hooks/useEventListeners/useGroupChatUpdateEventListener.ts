import { Event } from "@/interfaces/events.interface";
import {
  selectSelectedChatDetails,
  updateChatNameOrAvatar,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useEffect, useRef } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type GroupChatUpdateEventReceivePayload = {
  chatId: string;
  chatAvatar?: string;
  chatName?: string;
}

export const useGroupChatUpdateEventListener = () => {

  const dispatch = useAppDispatch();
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);

  const selectedChatDetailsRef = useRef(selectedChatDetails);

  useEffect(()=>{
    selectedChatDetailsRef.current = selectedChatDetails;
  },[selectedChatDetails])

  useSocketEvent(Event.GROUP_CHAT_UPDATE,({chatId,chatAvatar,chatName}:GroupChatUpdateEventReceivePayload) => {

    
    if(selectedChatDetailsRef.current?.id === chatId){
      dispatch(updateChatNameOrAvatar({avatar:chatAvatar,name:chatName,selectedChat:true}));
    }
    else{
        dispatch(updateChatNameOrAvatar({selectedChat:false,avatar:chatAvatar,name:chatName,chatId}));
    }
    }
  );



};
