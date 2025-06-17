import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { Dispatch, SetStateAction, useLayoutEffect } from "react";

type PropTypes = {
  setPage: Dispatch<SetStateAction<number>>;
};

export const useSetPageToOneOnChatChange = ({ setPage }: PropTypes) => {
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;

  useLayoutEffect(() => {
    setPage(1);
  }, [selectedChatId]);
};
