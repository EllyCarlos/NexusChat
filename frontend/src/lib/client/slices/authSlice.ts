import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store/store"; // Corrected import path for RootState

// Define the shape of your initial state
type InitialState = {
  loggedInUser: FetchUserInfoResponse | null;
  authToken: string | null;
  // Consider adding loading and error states for better UI feedback
  isLoading: boolean;
  error: string | null;
};

// Initial state for the auth slice
const initialState: InitialState = {
  loggedInUser: null,
  authToken: null,
  isLoading: false, // Default loading state
  error: null,      // Default error state
};

const authSlice = createSlice({
  name: "authSlice",
  initialState,
  reducers: {
    // Action to update the entire loggedInUser object
    updateLoggedInUser: (
      state,
      action: PayloadAction<FetchUserInfoResponse | null>
    ) => {
      state.loggedInUser = action.payload;
      // When user logs in/out, clear any previous error/loading state
      state.isLoading = false;
      state.error = null;

      // Crucial: If you are storing `loggedInUser` in localStorage in your components,
      // it's generally better to let the Redux state be the single source of truth.
      // However, if localStorage is used for persistence across page reloads (hydration),
      // ensure you hydrate the Redux store from localStorage on app load.
      // If `action.payload` is null (logout), consider clearing localStorage here too.
      if (action.payload === null) {
        localStorage.removeItem("loggedInUser"); // Ensure consistency
        localStorage.removeItem("authToken"); // Ensure consistency if authToken also stored there
      } else {
        // You might want to save it here if Redux state is not persistent
        // across full page reloads without re-fetching.
        // localStorage.setItem("loggedInUser", JSON.stringify(action.payload));
      }
    },
    // Action to update only the publicKey of the loggedInUser
    updateLoggedInUserPublicKey: (
      state,
      action: PayloadAction<Required<Pick<FetchUserInfoResponse, "publicKey">>>
    ) => {
      if (state.loggedInUser) {
        state.loggedInUser.publicKey = action.payload.publicKey;
        // If you're persisting loggedInUser in localStorage, update it there too.
        // This makes sure the publicKey update is reflected in persistence.
        // const updatedUser = { ...state.loggedInUser, publicKey: action.payload.publicKey };
        // localStorage.setItem("loggedInUser", JSON.stringify(updatedUser));
      }
    },
    // Action to update only the notificationsEnabled status of the loggedInUser
    updateLoggedInUserNotificationStatus: (
      state,
      action: PayloadAction<boolean>
    ) => {
      if (state.loggedInUser) {
        state.loggedInUser.notificationsEnabled = action.payload;
        // If you're persisting loggedInUser in localStorage, update it there too.
        // const updatedUser = { ...state.loggedInUser, notificationsEnabled: action.payload };
        // localStorage.setItem("loggedInUser", JSON.stringify(updatedUser));
      }
    },
    // Action to set the authentication token
    setAuthToken: (state, action: PayloadAction<string | null>) => { // Allow null for logout
      state.authToken = action.payload;
      // If you're persisting authToken in localStorage, update it here too.
      if (action.payload === null) {
        localStorage.removeItem("authToken");
      } else {
        // localStorage.setItem("authToken", action.payload);
      }
    },
    // New: Actions for handling loading and errors from async operations (e.g., login/signup)
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.isLoading = false; // Always stop loading on error
    },
    // New: Action for a full logout/reset of the auth slice state
    resetAuthState: (state) => {
        state.loggedInUser = null;
        state.authToken = null;
        state.isLoading = false;
        state.error = null;
        // Ensure localStorage is also cleared on full reset
        localStorage.removeItem("loggedInUser");
        localStorage.removeItem("authToken");
        localStorage.removeItem("tempPassword"); // Remove this if it was still there
    }
  },
});

// Selectors to easily access parts of the state
export const selectLoggedInUser = (state: RootState) =>
  state.authSlice.loggedInUser;
export const selectAuthToken = (state: RootState) =>
  state.authSlice.authToken;
export const selectAuthLoading = (state: RootState) =>
  state.authSlice.isLoading;
export const selectAuthError = (state: RootState) =>
  state.authSlice.error;


// Export actions
export const {
  updateLoggedInUser,
  updateLoggedInUserPublicKey,
  updateLoggedInUserNotificationStatus,
  setAuthToken,
  setLoading,  // Export new actions
  setError,    // Export new actions
  resetAuthState, // Export new reset action
} = authSlice.actions;

// Export the reducer
export default authSlice.reducer; // Export the reducer directly, not the slice object