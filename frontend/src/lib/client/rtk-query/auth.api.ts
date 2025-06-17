import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { RootState } from "../store/store";

export const authApi = createApi({
  reducerPath: "authApi",
  baseQuery: fetchBaseQuery({
    baseUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/auth`,
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

    updateFcmToken: builder.mutation<{ fcmTokenExists: boolean },{ fcmToken: string }>({
      query: ({ fcmToken }) => ({
        url: "/user/update-fcm-token",
        method: "PATCH",
        body: { fcmToken },
      }),
    }),

    checkAuth: builder.query<FetchUserInfoResponse | null, void>({
      query: () => "/check-auth",
    }),
    
  }),
});

export const {
  useCheckAuthQuery,
  useUpdateFcmTokenMutation,
} = authApi;
