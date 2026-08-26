import { useEffect, useState } from "react";

type PropTypes = {
  selectedAttachments: Blob[];
};

export const createAttachmentPreviewUrls = (attachments: Blob[]) =>
  attachments.map((attachment) => URL.createObjectURL(attachment));

export const revokeAttachmentPreviewUrls = (previewUrls: string[]) => {
  previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
};

export const useGenerateAttachmentsPreview = ({
  selectedAttachments,
}: PropTypes) => {
  const [attachmentsPreview, setAttachmentsPreview] = useState<string[]>([]);

  useEffect(() => {
    const generatedPreviewUrls = createAttachmentPreviewUrls(selectedAttachments);
    // Object URLs are browser resources and must be created after render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttachmentsPreview(generatedPreviewUrls);

    return () => {
      setAttachmentsPreview((currentPreviewUrls) =>
        currentPreviewUrls === generatedPreviewUrls ? [] : currentPreviewUrls
      );
      revokeAttachmentPreviewUrls(generatedPreviewUrls);
    };
  }, [selectedAttachments]);

  return { attachmentsPreview};
};
