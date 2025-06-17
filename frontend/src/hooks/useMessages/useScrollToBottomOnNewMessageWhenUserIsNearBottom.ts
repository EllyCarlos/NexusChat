import { Message } from "@/interfaces/message.interface";
import { selectNewMessageFormed } from "@/lib/client/slices/uiSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { RefObject, useEffect, useState } from "react";

type PropTypes = {
  container: RefObject<HTMLDivElement | null> // The container element that holds the chat messages
  isNearBottom : boolean; // A boolean indicating whether the user is near the bottom of the chat
  messages: Message[]; // The list of messages that triggers scrolling when updated
  prevHeightRef: RefObject<number>; // A ref to store the previous container height
  prevScrollTopRef: RefObject<number>; // A ref to store the previous scroll position
};

export const useScrollToBottomOnNewMessageWhenUserIsNearBottom = ({
  container,
  isNearBottom,
  messages,
  prevHeightRef,
  prevScrollTopRef,
}: PropTypes) => {


  const newMessageFormed = useAppSelector(selectNewMessageFormed);
  
  const [isChanged,setIsChanged] = useState<boolean>(false);

  useEffect(()=>{
    prevHeightRef.current = 0;
    prevScrollTopRef.current = 0;
        setTimeout(() => {
          console.log('ran man');
          if(container.current && isNearBottom){
            container.current.scrollTop = container.current.scrollHeight;
            setIsChanged(!isChanged);
          }
        }, 50);
      
  },[container,isNearBottom, messages.length, prevHeightRef, prevScrollTopRef,newMessageFormed])


  useEffect(()=>{
    if(newMessageFormed && isNearBottom){
      setIsChanged(!isChanged);
    }
  },[newMessageFormed,isNearBottom]);
  
  useEffect(()=>{
    setTimeout(() => {
      if(container.current){
        console.log('TRIGGERED FALLBACK');
        container.current.scrollTop = container.current.scrollHeight;
      }
    }, 300);
  },[isChanged]);

};


