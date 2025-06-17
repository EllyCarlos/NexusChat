import { fetchUserFriendsResponse } from "@/lib/server/services/userService"
import { motion } from "framer-motion"
import Image from "next/image"

type PropTypes = {
    friend:fetchUserFriendsResponse
    handleAddOrRemoveMember:(newMember: string) => void
    selectedMembers:Array<string>
}

export const FriendCard = ({friend,selectedMembers,handleAddOrRemoveMember}:PropTypes) => {
  return (
    <motion.div whileHover={{x:-1}} whileTap={{scale:0.980}} onClick={()=>handleAddOrRemoveMember(friend.id)} className={`flex items-center gap-x-2 ${selectedMembers.includes(friend.id)?"bg-primary text-white hover:bg-primary-dark shadow-2xl":"bg-secondary text-text hover:bg-secondary-darker"} p-2 rounded-lg cursor-pointer`}>
        <Image width={100} height={100} className="h-7 w-7 object-cover rounded-full" src={friend.avatar} alt={`${friend.username} avatar`} />
        <p className="text-inherit">{friend.username}</p>
    </motion.div>
  )
}
