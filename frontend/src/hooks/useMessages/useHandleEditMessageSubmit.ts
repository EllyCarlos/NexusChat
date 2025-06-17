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

  const handleEditMessageSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();

    editMessage(messageId, updatedContentValue.trim());

    setEditMessageId("");
    setOpenContextMenuMessageId("");
  };

  return { handleEditMessageSubmit };
};
