import { useHandleEditMessageSubmit } from "@/hooks/useMessages/useHandleEditMessageSubmit";
import { motion } from "framer-motion";
import { useState } from "react";
import { CrossIcon } from "../ui/icons/CrossIcon";
import { SendIcon } from "../ui/icons/SendIcon";

type PropTypes = {
  prevContentValue: string;
  messageId: string;
  setEditMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
};

export const EditMessageForm = ({
  prevContentValue,
  messageId,
  setEditMessageId,
  setOpenContextMenuMessageId,
}: PropTypes) => {

  const [updatedContentValue, setUpdatedContentValue] = useState<string>(prevContentValue);

  const { handleEditMessageSubmit } = useHandleEditMessageSubmit({
    messageId,
    setEditMessageId,
    setOpenContextMenuMessageId,
    updatedContentValue,
  });
  
  const handleCancel = () => {
    setEditMessageId("");
    setOpenContextMenuMessageId("");
  };

  return (
    <motion.form
      initial={{ x: 3 }}
      animate={{ x: 0 }}
      onSubmit={handleEditMessageSubmit}
      className="flex items-center gap-y-3 flex-col "
    >
      <textarea
        cols={25}
        value={updatedContentValue}
        onChange={(e) => setUpdatedContentValue(e.target.value)}
        className="p-4 text-text bg-primary focus:border-none focus:outline-none"
      />
      <div className="flex justify-end gap-x-1 w-full">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleCancel}
          type="button"
          className="bg-red-500/85 text-white p-2 rounded-full"
        >
          <CrossIcon />
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={
            updatedContentValue.trim() === prevContentValue.trim() ||
            !updatedContentValue.trim()
          }
          type="submit"
          className="bg-background text-text p-2 rounded-full disabled:bg-secondary-darker "
        >
          <SendIcon />
        </motion.button>
      </div>
    </motion.form>
  );
};
