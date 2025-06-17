import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { AnimatePresence, motion } from "framer-motion";
import { TypingIndicatorWithUserList } from "../chat/TypingIndicatorWithUserList";

type PropTypes = {
  selectedChatDetails: fetchUserChatsResponse;
};

export const TypingIndicator = ({
  selectedChatDetails,
}: PropTypes) => {
  return (
    <AnimatePresence>
      {selectedChatDetails.typingUsers.length && (
        <motion.div
          className="w-fit"
          variants={{
            hide: { opacity: 0, x: -10 },
            show: { opacity: 1, x: 0 },
          }}
          initial="hide"
          animate="show"
          exit="hide"
        >
          <TypingIndicatorWithUserList
            isGroupChat={selectedChatDetails.isGroupChat}
            users={selectedChatDetails.typingUsers}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
