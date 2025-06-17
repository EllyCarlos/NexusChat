import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useRemoveMember } from "../../hooks/useMember/useRemoveMember";
import { useToggleRemoveMemberForm } from "../../hooks/useUI/useToggleRemoveMemberForm";
import { selectLoggedInUser } from "../../lib/client/slices/authSlice";
import { selectSelectedChatDetails } from "../../lib/client/slices/chatSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { RemoveMemberFormUserList } from "./RemoveMemberFormUserList";

const RemoveMemberForm = () => {

  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);

  const { toggleRemoveMemberForm } = useToggleRemoveMemberForm();

  const loggedInUserId = useAppSelector(selectLoggedInUser);
  const { removeMember } = useRemoveMember();

  const isMemberLength3 = selectedChatDetails && selectedChatDetails.ChatMembers.length === 3;

  const [searchVal, setSearchVal] = useState<string>("");
  const [filteredMembers, setFilteredMembers] = useState<fetchUserChatsResponse['ChatMembers']>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!searchVal.trim().length && selectedChatDetails) {
      setFilteredMembers(selectedChatDetails.ChatMembers.filter(member => member.user.id !== loggedInUserId?.id))
    }
    else {
      setFilteredMembers(filteredMembers.filter(member =>member.user.username.toLowerCase().includes(searchVal.toLowerCase())));
    }
  }, [searchVal]);

  const toggleSelection = (memberId: string) => {
    if (selectedChatDetails) {
      if (selectedMembers.includes(memberId)) {
        setSelectedMembers(prev =>prev.filter(member => member !== memberId));
      }
      else {
        if (selectedChatDetails.ChatMembers.length - selectedMembers.length > 3) {
          setSelectedMembers((prev) => [...prev, memberId]);
        }
        else {
          toast.error("Group cannot have less than 3 members");
        }
      }
    }
  };

  const handleRemoveMember = () => {
    if (selectedChatDetails) {
      toggleRemoveMemberForm();
      removeMember({
        chatId:selectedChatDetails.id,
        members:selectedMembers
      });
    }
  };

  return (
    <div className="flex flex-col gap-y-5">

      <div className="flex flex-col gap-y-1">
        <h4 className="text-xl">Remove Member</h4>
        {isMemberLength3 && (
          <p className="text-secondary-darker max-w-[30rem]">
            You cannot remove any members as group chat requires a minimum of 3
            members
          </p>
        )}
      </div>

      <div className="flex flex-col gap-y-4">

        {!isMemberLength3 && (
          <input
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            className="p-3 rounded w-full text-text bg-background outline outline-1 outline-secondary-darker"
            placeholder="Search Members"
          />
        )}

        <div className="overflow-y-auto max-h-52 ">
          {selectedChatDetails && (
            <RemoveMemberFormUserList
              selectable={isMemberLength3 ? false : true}
              members={filteredMembers}
              selectedMembers={selectedMembers}
              toggleSelection={toggleSelection}
            />
          )}
        </div>

      </div>

      {selectedMembers.length > 0 && (
        <motion.div
          initial={{ y: 5 }}
          animate={{ y: 0 }}
          className="flex flex-col gap-y-2"
        >
          <button
            onClick={handleRemoveMember}
            className="bg-background text-white py-2 rounded-sm disabled:bg-gray-400"
          >
            Remove {selectedMembers.length}{" "}
            {selectedMembers.length === 1 ? "member" : "members"}
          </button>
        </motion.div>
      )}
    </div>
  );
};

export default RemoveMemberForm;
