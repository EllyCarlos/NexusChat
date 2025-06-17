import { useEffect, useState } from "react";

type PropTypes = {
  selectedAttachments: Blob[];
};
export const useGenerateAttachmentsPreview = ({
  selectedAttachments,
}: PropTypes) => {
  const [attachmentsPreview, setAttachmentsPreview] = useState<string[]>([]);

  useEffect(() => {
    if (selectedAttachments.length>0){
      setAttachmentsPreview(
        selectedAttachments.map((attachment) => URL.createObjectURL(attachment))
      );
    }
    else{
      setAttachmentsPreview([]);
    }
    return () => {
      attachmentsPreview.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedAttachments]);

  return { attachmentsPreview};
};
