"use client";
import { motion } from "framer-motion";
import Image from "next/image";

type PropTypes = {
  preview: string;
  handleRemoveSelectedAttachment: (indexToBeRemoved: number) => void;
  index: number;
};

export const SelectedAttachmentPreviewItem = ({
  preview,
  handleRemoveSelectedAttachment,
  index,
}: PropTypes) => {
  return (
    <motion.div whileHover={{y: -2 }} className="relative cursor-pointer">
      <button
        onClick={() => handleRemoveSelectedAttachment(index)}
        className="absolute bg-gray-300 rounded-full w-7 h-7 -right-2 -top-2"
      >
        -
      </button>
      <Image
        width={50}
        height={50}
        className="w-20 h-20 object-cover"
        src={preview}
        alt="selected-attachment"
      />
    </motion.div>
  );
};
