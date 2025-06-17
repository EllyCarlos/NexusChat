import { fetchUserFriendsResponse } from "@/lib/server/services/userService";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { RootState } from "../store/store";

export const friendApi = createApi({
    reducerPath:"friendApi",
    baseQuery:fetchBaseQuery({
        baseUrl:`${process.env.NEXT_PUBLIC_BASE_URL}/friend`,
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
        getFriends:builder.query<fetchUserFriendsResponse[],void>({
            query:()=>"/"
        })
    })
})

export const {
    useGetFriendsQuery
} = friendApi