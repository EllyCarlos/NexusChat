import { useEditMessage } from "./useEditMessage";

type PropTypes = {
  messageId: string;
  updatedContentValue: string;
  setEditMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
};

export const useHandleEditMessageSubmit = ({
  messageId,
  setEditMessageId,
  setOpenContextMenuMessageId,
  updatedContentValue,
}: PropTypes) => {
  
  const { editMessage } = useEditMessage();

  const handleEditMessageSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const updated = await editMessage(messageId, updatedContentValue.trim());
    if (!updated) return;

    setEditMessageId("");
    setOpenContextMenuMessageId("");
  };

  return { handleEditMessageSubmit };
};
