import { attachmentApi } from "@/lib/client/rtk-query/attachment.api";
import { authApi } from "@/lib/client/rtk-query/auth.api";
import { chatApi } from "@/lib/client/rtk-query/chat.api";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { requestApi } from "@/lib/client/rtk-query/request.api";
import { userApi } from "@/lib/client/rtk-query/user.api";
import { configureStore } from "@reduxjs/toolkit";
import { friendApi } from "@/lib/client/rtk-query/friend.api"; // Use absolute path for consistency
import authSliceReducer from "@/lib/client/slices/authSlice"; // Import as reducer (default export)
import chatSliceReducer from "@/lib/client/slices/chatSlice"; // Import as reducer
import uiSliceReducer from "@/lib/client/slices/uiSlice";     // Import as reducer
import callSliceReducer from "@/lib/client/slices/callSlice"; // Import as reducer


export const makeStore = () => {
  return configureStore({
    reducer: {
      // Use the imported reducer directly
      authSlice: authSliceReducer,
      chatSlice: chatSliceReducer,
      uiSlice: uiSliceReducer,
      callSlice: callSliceReducer,

      // RTK Query API reducers
      [authApi.reducerPath]: authApi.reducer,
      [chatApi.reducerPath]: chatApi.reducer,
      [messageApi.reducerPath]: messageApi.reducer,
      [userApi.reducerPath]: userApi.reducer,
      [requestApi.reducerPath]: requestApi.reducer,
      [attachmentApi.reducerPath]: attachmentApi.reducer,
      [friendApi.reducerPath]: friendApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false // Keep this if you have non-serializable data (e.g., File objects, Date objects not serialized)
      })
        // Concatenate all RTK Query API middlewares
        .concat(authApi.middleware)
        .concat(chatApi.middleware)
        .concat(messageApi.middleware)
        .concat(userApi.middleware)
        .concat(requestApi.middleware)
        .concat(attachmentApi.middleware)
        .concat(friendApi.middleware),
  });
};

// Define types for the store, state, and dispatch
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

// Optional: Export a default store instance if you're not using makeStore in every context
// This is common for client-side applications where you only need one store instance.
// export const store = makeStore();