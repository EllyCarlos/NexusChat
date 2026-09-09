import { Message } from "@/interfaces/message.interface";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { RootState } from "../store/store";

export type FetchMessagesResponse = {
    messages:Message[],
    totalPages:number
}

export type MessageContextResponse = {
    anchorMessageId:string,
    messages:Message[],
    hasMoreBefore:boolean,
    hasMoreAfter:boolean
}

export const messageApi = createApi({

    reducerPath:'messageApi',

    baseQuery:fetchBaseQuery({
        baseUrl:`${process.env.NEXT_PUBLIC_BASE_URL}/message`,
        credentials:'include',
        prepareHeaders: (headers, { getState }) => {
            const token = (getState() as RootState).authSlice.authToken;
            if (token) {
              headers.set("Authorization", `Bearer ${token}`);
            }
            return headers;
          },
    }),

    endpoints:(builder)=>({

        getMessagesByChatId:builder.query<FetchMessagesResponse,{chatId:string,page:number}>({
            query:({chatId,page})=>`/${chatId}?page=${page}`,
            serializeQueryArgs: ({ endpointName ,queryArgs:{chatId}}) => {
              return  `${endpointName}_${chatId}`
            },
            merge: (currentCache, newItems) => {
                currentCache.messages.unshift(...newItems.messages)
            },
        }),

        getPrivateSearchBootstrap:builder.query<FetchMessagesResponse,{chatId:string,limit?:number}>({
            query:({chatId,limit = 20})=>({
              url:`/${chatId}`,
              params:{page:1,limit},
            }),
        }),

        getMessageContext:builder.query<MessageContextResponse,{
          chatId:string,
          messageId:string,
          before?:number,
          after?:number
        }>({
            query:({chatId,messageId,before = 20,after = 0})=>({
              url:`/${chatId}/${messageId}/context`,
              params:{before,after},
            }),
        })

    })
})

export const {
    useLazyGetMessagesByChatIdQuery,
    useGetMessagesByChatIdQuery,
    useLazyGetPrivateSearchBootstrapQuery,
    useLazyGetMessageContextQuery,
} = messageApi
