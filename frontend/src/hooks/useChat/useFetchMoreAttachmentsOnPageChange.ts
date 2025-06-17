import { useLazyFetchAttachmentsQuery } from "@/lib/client/rtk-query/attachment.api";
import { useEffect, useState } from "react";

type PropTypes = {
    chatId:string
}

export const useFetchMoreAttachmentsOnPageChange = ({chatId}:PropTypes) => {
    
    const [fetchAttachments,{isFetching,data}] = useLazyFetchAttachmentsQuery();
    
    const [page,setPage] = useState(1);
    const [hasMore,setHasMore] = useState<boolean>(true);
    const [totalPage,setTotalPage] = useState<number>(1);

    useEffect(()=>{
        if(data?.totalPages){
            setHasMore(data.totalPages>1)
            setTotalPage(data.totalPages)
        }
    },[data?.totalPages])
    
    useEffect(()=>{
        if(hasMore && !isFetching){
            fetchAttachments({chatId,page},true);
        }
        if(page==totalPage){
            setHasMore(false)
        }
    },[page,hasMore,totalPage])

    return {hasMore,setPage,isFetching,data};
}
