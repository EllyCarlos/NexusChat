type PropTypes = {
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  openContextMenuMessageId: string | undefined;
  messageId: string;
};

export const useHandleContextMenuClick = ({
  setOpenContextMenuMessageId,
  openContextMenuMessageId,
  messageId,
}: PropTypes) => {

  const handleContextMenuClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenContextMenuMessageId(
      openContextMenuMessageId ? undefined : messageId
    );
  };

  return { handleContextMenuClick };
};
