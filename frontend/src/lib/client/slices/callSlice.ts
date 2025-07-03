import { fetchUserCallHistoryResponse } from "@/lib/server/services/callService";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "../store/store";

type InitialState = {
    isInCall:boolean;
    callHistoryId:string | null;
    myGlobalStream:MediaStream | null | undefined;
    callHistory:fetchUserCallHistoryResponse[];
    calleeIdPopulatedFromRecentCalls:string | null;
};

const initialState: InitialState = {
    isInCall:false,
    callHistoryId:null,
    myGlobalStream:undefined,
    callHistory:[],
    calleeIdPopulatedFromRecentCalls:null
};

const callSlice = createSlice({
  name: "callSlice",
  initialState,
  reducers: {

    setIsInCall:(state,action:PayloadAction<boolean>)=>{
        state.isInCall = action.payload
    },
    setCallHistoryId:(state,action:PayloadAction<string | null>)=>{
        state.callHistoryId = action.payload
    },
    setMyGlobalStream:(state,action:PayloadAction<MediaStream | null | undefined>)=>{
        state.myGlobalStream = action.payload
    },
    setCallHistory:(state,action:PayloadAction<fetchUserCallHistoryResponse[]>)=>{
        state.callHistory = action.payload
    },
    setCalleeIdPopulatedFromRecentCalls:(state,action:PayloadAction<string | null>)=>{
        state.calleeIdPopulatedFromRecentCalls = action.payload
    }
    
  },
});

export const selectIsInCall = (state: RootState) => state.callSlice.isInCall;
export const selectCallHistoryId = (state: RootState) => state.callSlice.callHistoryId;
export const selectMyGlobalStream = (state: RootState) => state.callSlice.myGlobalStream;
export const selectCallHistory = (state: RootState) => state.callSlice.callHistory;
export const selectCalleeIdPopulatedFromRecentCalls = (state: RootState) => state.callSlice.calleeIdPopulatedFromRecentCalls;

export const {
    setIsInCall,
    setCallHistoryId,
    setMyGlobalStream,
    setCallHistory,
    setCalleeIdPopulatedFromRecentCalls
} = callSlice.actions;

export default callSlice.reducer;
