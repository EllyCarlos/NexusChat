import { useEffect, useMemo } from "react";

type PropTypes = {
  selectedAttachments: Blob[];
};
export const useGenerateAttachmentsPreview = ({
  selectedAttachments,
}: PropTypes) => {
  const attachmentsPreview = useMemo(
    () => selectedAttachments.map((attachment) => URL.createObjectURL(attachment)),
    [selectedAttachments]
  );

  useEffect(() => {
    return () => {
      attachmentsPreview.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachmentsPreview]);

  return { attachmentsPreview};
};
