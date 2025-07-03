import { useFetchMoreAttachmentsOnPageChange } from "@/hooks/useChat/useFetchMoreAttachmentsOnPageChange";
import { useHandleSharedMediaScroll } from "@/hooks/useChat/useHandleSharedMediaScroll";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import Image from "next/image";
import { useRef } from "react";
import { CircleLoading } from "../shared/CircleLoading";
import type { Attachment } from "@/interfaces/attachment.interface";

export const SharedMedia = () => {

  const containerRef = useRef<HTMLDivElement>(null);
  const chatId = useAppSelector(selectSelectedChatDetails)?.id as string;

  const {data,hasMore,isFetching,setPage} = useFetchMoreAttachmentsOnPageChange({ chatId });

  const { handleSharedMediaScroll } = useHandleSharedMediaScroll({
    containerRef,
    hasMore,
    setPage,
    isFetching,
  });

  return (
    <div className="flex flex-col gap-y-4">
      <p> {data && data.totalAttachmentsCount > 0 ? `Shared media ${data.totalAttachmentsCount}` : "No shared media"} </p>
      <div
        ref={containerRef}
        onScroll={handleSharedMediaScroll}
        className="grid grid-cols-2 gap-4 place-items-center h-[28rem] overflow-y-auto"
      >
        {data?.attachments?.map((attachment: Attachment['attachments'][number], index: number) => (
  <Image
    key={index}
    height={200}
    width={200}
    className="w-40 h-40 object-cover"
    src={attachment.secureUrl}
    alt="attachment"
  />
))

}
        {isFetching && <CircleLoading />}
      </div>
    </div>
  );
};
