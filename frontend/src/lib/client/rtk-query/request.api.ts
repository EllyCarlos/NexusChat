import { fetchUserFriendRequestResponse } from "@/lib/server/services/userService";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { setFriendRequestForm } from "../slices/uiSlice";
import { RootState } from "../store/store";

export const requestApi = createApi({
  reducerPath: "requestApi",
  baseQuery: fetchBaseQuery({
    baseUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/request`,
    credentials: "include",
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).authSlice.authToken;
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return headers;
    },
  }),
  endpoints: (builder) => ({

    sendFriendRequest: builder.mutation<void, { receiverId: string }>({
      query: ({ receiverId }) => ({
        url: "/",
        method: "POST",
        body: { receiver: receiverId },
      }),
    }),

    getUserFriendRequests: builder.query<fetchUserFriendRequestResponse[],void>({
      query: () => "/",
    }),

    handleFriendRequest: builder.mutation<{id:string},{ requestId: fetchUserFriendRequestResponse["id"]; action: "accept" | "reject" }>({
      query: ({ requestId, action }) => ({
        url: `/${requestId}`,
        method: "DELETE",
        body: { action },
      }),
      async onQueryStarted({}, { dispatch, queryFulfilled }) {
        try {
          const { data:{id} } = await queryFulfilled;
          dispatch(
            requestApi.util.updateQueryData(
              "getUserFriendRequests",
              undefined,
              (draft) => {
                const friendRequestIndexToBeRemoved = draft.findIndex(
                  (draft) => draft.id === id
                );
                if (draft.length === 1) dispatch(setFriendRequestForm(false));
                if (friendRequestIndexToBeRemoved !== -1)
                  draft.splice(friendRequestIndexToBeRemoved, 1);
              }
            )
          );
        } catch (error) {
          console.log(error);
        }
      },
    }),
  }),
});

export const {
  useSendFriendRequestMutation,
  useGetUserFriendRequestsQuery,
  useHandleFriendRequestMutation,
} = requestApi;
