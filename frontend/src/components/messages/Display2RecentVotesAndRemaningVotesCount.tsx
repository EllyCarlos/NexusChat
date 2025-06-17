import { motion } from "framer-motion";
import Image from "next/image";

type PropTypes = {
  optionIndexToVotesMap: Record<number, {
    id: string;
    username: string;
    avatar: string;
}[]>
optionIndex:number;
}

export const Display2RecentVotesAndRemaningVotesCount = ({optionIndexToVotesMap,optionIndex}: PropTypes) => {

  const votes = optionIndexToVotesMap[optionIndex];
  const remainingVotes = votes?.length - 2;

  return (
    <div className="flex items-center">
      {votes?.slice(0, 2).map(({id,avatar,username}) => (
        <motion.span
          key={id}
          initial={{ x: -5, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
        >
          <Image src={avatar} className="size-6 rounded-full object-cover" width={100} height={100} alt={username} />
        </motion.span>
      ))}
      {remainingVotes > 0 && (
        <p className="w-8 h-8 rounded-full bg-secondary flex justify-center items-center">
          +{remainingVotes}
        </p>
      )}
    </div>
  );
};
