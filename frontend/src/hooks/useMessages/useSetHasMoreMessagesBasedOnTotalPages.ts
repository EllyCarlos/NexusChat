import { Dispatch, SetStateAction, useEffect } from "react";

type PropTypes = {
  totalPages: number;
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>
};

export const useSetHasMoreMessagesBasedOnTotalPages = ({setHasMoreMessages,totalPages}:PropTypes) => {
    useEffect(() => {
        setHasMoreMessages(totalPages==1?false:true);
      }, [totalPages]);
};
