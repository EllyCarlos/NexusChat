"use client";

import { useMediaQuery } from "@/hooks/useUtils/useMediaQuery";
import { useSwipe } from "@/hooks/useUtils/useSwipe";
import {
  selectChatDetailsBar,
  setChatDetailsBar,
} from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { motion } from "framer-motion";

type PropTypes = {
  children: React.ReactNode;
};

export const ChatDetailsWrapper = ({ children }: PropTypes) => {
  const chatDetailsBar = useAppSelector(selectChatDetailsBar);
  const dispatch = useAppDispatch();
  const is640 = useMediaQuery(640);

  const {
    onTouchStart: onTouchStartChatDetails,
    onTouchMove: onTouchMoveChatDetails,
    onTouchEnd: onTouchEndChatDetails,
  } = useSwipe(
    75,
    1536,
    () => {},
    () => dispatch(setChatDetailsBar(false))
  );

  return (
    <motion.div
      onTouchMove={onTouchMoveChatDetails}
      onTouchEnd={onTouchEndChatDetails}
      onTouchStart={onTouchStartChatDetails}
      variants={{
        hide: { right: is640 ? "-40rem" : "-26rem" },
        show: { right: 0 },
      }}
      initial="hide"
      animate={chatDetailsBar ? "show" : "hide"}
      transition={{ type: "spring", duration: 0.4 }}
      className="flex-[.6] min-w-[20rem] bg-background max-sm:w-full max-2xl:fixed max-2xl:px-4 max-2xl:w-[25rem]"
    >
      {children}
    </motion.div>
  );
};
