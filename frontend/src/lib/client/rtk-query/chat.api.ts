import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { RootState } from "../store/store";

export const chatApi = createApi({
    reducerPath:"chatApi",
    baseQuery:fetchBaseQuery({
        baseUrl:process.env.NEXT_PUBLIC_BASE_URL,
        credentials:"include",
        prepareHeaders: (headers, { getState }) => {
            const token = (getState() as RootState).authSlice.authToken;
            if (token) {
              headers.set("Authorization", `Bearer ${token}`);
            }
            return headers;
          },
    }),
    endpoints:(builder)=>({
        createChat:builder.mutation<void,Required<Pick<fetchUserChatsResponse,'name'> & {members:string[],isGroupChat:string}> & {avatar?:Blob}>({
            query:({name,members,isGroupChat,avatar})=>{
                const formData = new FormData()
                formData.append("name", name || 'default_name');
                for (const member of members) formData.append("members[]", member);
                formData.append("isGroupChat", isGroupChat); 
                if(avatar) formData.append("avatar",avatar)
                return {
                    url: "/chat",
                    method: "POST",
                    body: formData,
                  };
            },
        }),
        updateChat:builder.mutation<void,{chatId:string,avatar?:Blob,name?:string}>({
            query:({avatar,name,chatId})=>{
                const formData = new FormData()
                if(avatar) formData.append('avatar',avatar)
                if(name) formData.append("name",name)
                return {
                    url: `/chat/${chatId}`,
                    method: "PATCH",
                    body: formData,
                };
            }
        }),
        addMember:builder.mutation<void,{members:string[],chatId:string}>({
            query:({chatId,members})=>({
                url:`/chat/${chatId}/members`,
                method:"PATCH",
                body:{members}
            })
        }),
        removeMember:builder.mutation<void,{chatId:string,members:string[]}>({
            query:({chatId,members})=>({
                url:`/chat/${chatId}/members`,
                method:"DELETE",
                body:{members}
            })
        })
    })
})

export const {
    useCreateChatMutation,
    useAddMemberMutation,
    useRemoveMemberMutation,
    useUpdateChatMutation,
} = chatApi