import { RefObject } from "react";

type PropTypes = {
  containerRef: RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  isFetching:boolean
}

export const useHandleSharedMediaScroll = ({containerRef,hasMore,setPage,isFetching}:PropTypes) => {

  const handleSharedMediaScroll = ()=>{
    const container = containerRef?.current;
    if(container){
      const isCloseToBottom = container.scrollHeight - container.scrollTop <= container.clientHeight * 1.1; // Adjust multiplier if needed  
      if(isCloseToBottom && hasMore && !isFetching){
        setPage(prev=>prev+1);
      }
    }
  }

  return {handleSharedMediaScroll};
}
