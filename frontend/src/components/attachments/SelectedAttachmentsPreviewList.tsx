"use client";
import { Dispatch, SetStateAction } from "react";
import { SelectedAttachmentPreviewItem } from "./SelectedAttachmentsPreviewItem";

type PropTypes = {
  attachmentsPreview: string[];
  setSelectedAttachments: Dispatch<SetStateAction<Blob[]>>;
  selectedAttachments: Blob[];
};

export const SelectedAttachmentsPreviewList = ({
  attachmentsPreview,
  setSelectedAttachments,
  selectedAttachments,
}: PropTypes) => {
  
  const handleRemoveSelectedAttachment = (indexToBeRemoved: number) => {
    setSelectedAttachments(selectedAttachments?.filter((_, index) => index !== indexToBeRemoved));
  };

  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {attachmentsPreview.map((preview, index) => (
        <SelectedAttachmentPreviewItem
          key={index}
          handleRemoveSelectedAttachment={handleRemoveSelectedAttachment}
          index={index}
          preview={preview}
        />
      ))}
    </div>
  );
};
