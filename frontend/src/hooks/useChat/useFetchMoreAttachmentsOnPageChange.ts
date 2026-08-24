import { useLazyFetchAttachmentsQuery } from "@/lib/client/rtk-query/attachment.api";
import { useEffect, useRef, useState } from "react";

type PropTypes = {
    chatId:string
}

export const useFetchMoreAttachmentsOnPageChange = ({chatId}:PropTypes) => {
    
    const [fetchAttachments,{isFetching,data}] = useLazyFetchAttachmentsQuery();

    const [page,setPage] = useState(1);
    const lastRequestKeyRef = useRef<string | null>(null);
    const totalPage = data?.totalPages ?? 1;
    const hasMore = data === undefined || page < totalPage;

    useEffect(()=>{
        const requestKey = `${chatId}:${page}`;
        if (
            isFetching ||
            lastRequestKeyRef.current === requestKey ||
            (data !== undefined && page > totalPage)
        ) {
            return;
        }

        lastRequestKeyRef.current = requestKey;
        void fetchAttachments({chatId,page},true);
    },[chatId, data, fetchAttachments, isFetching, page, totalPage])

    return {hasMore,setPage,isFetching,data};
}
