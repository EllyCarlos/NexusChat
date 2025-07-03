import { DEFAULT_AVATAR } from "@/constants";
import Image from "next/image";
import { useState } from "react";
import { selectAttachments } from "../../lib/client/slices/uiSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { ChevronRightIcon } from "./icons/ChevronRightIcon";
import { ChevronLeftIcon } from "./icons/ChevronLeftIcon";

// Define the interface for an Attachment based on its usage and database schema
interface Attachment {
  id: string; // Assuming an ID field as per migration.sql
  secureUrl: string; // Used for Image src
  cloudinaryPublicId: string; // As per migration.sql
  // Add any other properties if they exist on your Attachment objects
}

const AttachmentPreview = () => {
  // attachments will now correctly infer its type from selectAttachments
  // which should return Attachment[] based on the slice definition.
  const attachments = useAppSelector(selectAttachments);

  const [currentAttachmentIndex, setcurrentAttachmentIndex] = useState(0);

  const handlePreviousClick = () => {
    if (currentAttachmentIndex !== 0) {
      setcurrentAttachmentIndex((prev) => prev - 1);
    }
  };

  const handleNextClick = () => {
    if (attachments && currentAttachmentIndex !== attachments.length - 1) {
      setcurrentAttachmentIndex((prev) => prev + 1);
    }
  };

  return (
    <div className="flex flex-col justify-center items-center py-4 gap-y-10 ">
      <div className="flex items-center gap-x-4">
        <button onClick={handlePreviousClick} className="max-sm:hidden">
          <ChevronLeftIcon />
        </button>

        {attachments && (
          <Image
            width={500}
            height={500}
            className="w-[25rem] h-[30rem] max-lg:w-[25rem] max-lg:h-[25rem] max-md:w-[20rem] max-md:h-[20rem] max-sm:w-[] max-sm:h-[] object-contain"
            src={attachments[currentAttachmentIndex]?.secureUrl || DEFAULT_AVATAR}
            alt="image"
          />
        )}

        <button onClick={handleNextClick} className="max-sm:hidden">
          <ChevronRightIcon />
        </button>
      </div>

      <div className="flex items-center w-full justify-center flex-wrap gap-y-4 gap-x-2">
        {/* Corrected: Explicitly type 'attachment' as Attachment and 'index' as number */}
        {attachments && attachments.map((attachment: Attachment, index: number) => (
          <Image
            key={index}
            onClick={() => setcurrentAttachmentIndex(index)}
            className={`w-20 h-20 object-contain cursor-pointer ${
              currentAttachmentIndex === index
                ? "outline outline-1 outline-secondary-darker p-1 rounded-sm"
                : null
            } `}
            src={attachment.secureUrl}
            alt="attachment"
            height={200}
            width={200}
          />
        ))}
      </div>
    </div>
  );
};

export default AttachmentPreview;
