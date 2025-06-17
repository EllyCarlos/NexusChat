import { Message } from "@/interfaces/message.interface";
import { motion } from "framer-motion";

type PropTypes = {
  reactions: Message["reactions"];
};

export const DisplayFirst3ReactionsAndRemainingReactionsCounts = ({
  reactions,
}: PropTypes) => {
  const remainingReactions = reactions.length - 3;

  return (
    <>
      {reactions.slice(0, 3).map((reaction, index) => (
        <motion.p
          key={index}
          variants={{
            hide: { opacity: 0, y: 10, scale: 1.5 },
            show: { opacity: 1, y: 0, scale: 1 },
          }}
          initial="hide"
          animate="show"
        >
          {reaction.reaction}
        </motion.p>
      ))}
      {remainingReactions > 0 && (
        <span className="rounded-full">+{remainingReactions}</span>
      )}
    </>
  );
};
