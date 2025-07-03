import { IncomingCallEventReceivePayload } from "@/hooks/useCalls/useIncomingCallListener";
import { SingleAttachment } from "@/interfaces/attachment.interface";
import { Message } from "@/interfaces/message.interface";
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store/store";

interface InitialState {
  isDarkMode: boolean;
  navMenu: boolean;
  newgroupChatForm: boolean;
  addMemberForm: boolean;
  addFriendForm: boolean;
  friendRequestForm: boolean;
  profileForm: boolean;
  removeMemberForm: boolean;
  gifForm: boolean;
  attachments: SingleAttachment[] | null;
  chatBar: boolean;
  chatDetailsBar: boolean;
  pollForm: boolean;
  viewVotes: boolean;
  votesData: {
    question:string;
    options:string[];
    optionIndexToVotesMap: Record<number, {
      id: string;
      username: string;
      avatar: string;
  }[]>
  } | null
  chatUpdateForm: boolean;
  activeJoinedChat: string | null;
  recoverPrivateKeyForm: boolean;
  settingsForm: boolean;
  notificationPermissionForm: boolean;
  callDisplay: boolean;
  isIncomingCall:boolean
  incomingCallInfo: IncomingCallEventReceivePayload | null;
  newMessageFormed: boolean;
  callHistoryTabSelected: boolean;
  replyingToMessageData:string | null
  replyingToMessageId:string | null
  pinnedMessageDisplay:boolean
  pinnedMessageData:Message | null
}

const initialState: InitialState = {
  isDarkMode: false,
  navMenu: false,
  newgroupChatForm: false,
  addMemberForm: false,
  addFriendForm: false,
  friendRequestForm: false,
  profileForm: false,
  removeMemberForm: false,
  gifForm: false,
  attachments: null,
  chatBar: true,
  chatDetailsBar: false,
  pollForm: false,
  viewVotes: false,
  votesData: null,
  chatUpdateForm: false,
  activeJoinedChat: null,
  recoverPrivateKeyForm: false,
  settingsForm: false,
  notificationPermissionForm: false,
  callDisplay:false,
  isIncomingCall:false,
  incomingCallInfo:null,
  callHistoryTabSelected:false,
  newMessageFormed:false,
  replyingToMessageData:null,
  replyingToMessageId:null,
  pinnedMessageDisplay:false,
  pinnedMessageData:null

};
const uiSlice = createSlice({
  name: "uiSlice",
  initialState,
  reducers: {
    setNavMenu: (state, action: PayloadAction<boolean>) => {
      state.navMenu = action.payload;
    },
    setNewgroupChatForm: (state, action: PayloadAction<boolean>) => {
      state.newgroupChatForm = action.payload;
    },
    setAddMemberForm: (state, action: PayloadAction<boolean>) => {
      state.addMemberForm = action.payload;
    },
    setAddFriendForm: (state, action: PayloadAction<boolean>) => {
      state.addFriendForm = action.payload;
    },
    setFriendRequestForm: (state, action: PayloadAction<boolean>) => {
      state.friendRequestForm = action.payload;
    },
    setProfileForm: (state, action: PayloadAction<boolean>) => {
      state.profileForm = action.payload;
    },
    setRemoveMemberForm: (state, action: PayloadAction<boolean>) => {
      state.removeMemberForm = action.payload;
    },
    setGifForm: (state, action: PayloadAction<boolean>) => {
      state.gifForm = action.payload;
    },
    setDarkMode: (state, action: PayloadAction<boolean>) => {
      state.isDarkMode = action.payload;
    },
    setAttachments: (state, action: PayloadAction<{ secureUrl: string }[]>) => {
  state.attachments = action.payload.map((att, idx) => ({
    id: `temp-${idx}`,
    secureUrl: att.secureUrl,
    cloudinaryPublicId: '', // placeholder
    }));  
  },
    resetAttachments: (state) => {
      state.attachments = null;
    },
    setChatBar: (state, action: PayloadAction<boolean>) => {
      state.chatBar = action.payload;
    },
    setChatDetailsBar: (state, action: PayloadAction<boolean>) => {
      state.chatDetailsBar = action.payload;
    },
    setPollForm: (state, action: PayloadAction<boolean>) => {
      state.pollForm = action.payload;
    },
    setViewVotes: (state, action: PayloadAction<boolean>) => {
      state.viewVotes = action.payload;
    },
    setVotesData: (state,action: PayloadAction<{
      question:string;
      options:string[];
      optionIndexToVotesMap: Record<number, {
        id: string;
        username: string;
        avatar: string;
    }[]>
    }>) => {
      state.votesData = action.payload;
    },
    setChatUpdateForm: (state, action: PayloadAction<boolean>) => {
      state.chatUpdateForm = action.payload;
    },
    setactiveJoinedChat: (state, action: PayloadAction<string>) => {
      state.activeJoinedChat = action.payload;
    },
    setRecoverPrivateKeyForm: (state, action: PayloadAction<boolean>) => {
      state.recoverPrivateKeyForm = action.payload;
    },
    setSettingsForm: (state, action: PayloadAction<boolean>) => {
      state.settingsForm = action.payload;
    },
    setCallDisplay: (state, action: PayloadAction<boolean>) => {
      state.callDisplay = action.payload;
    },
    setNotificationPermissionForm: (state, action: PayloadAction<boolean>) => {
      state.notificationPermissionForm = action.payload;
    },
    setIsIncomingCall: (state, action: PayloadAction<boolean>) => {
      state.isIncomingCall = action.payload;
    },
    setInComingCallInfo: (state, action: PayloadAction<IncomingCallEventReceivePayload | null>) => {
      state.incomingCallInfo = action.payload;
    },
    setCallHistoryTabSelected: (state, action: PayloadAction<boolean>) => {
      state.callHistoryTabSelected = action.payload;
    },
    setNewMessageFormed: (state, action: PayloadAction<boolean>) => {
      state.newMessageFormed = action.payload;
    },
    setReplyingToMessageData: (state, action: PayloadAction<string | null>) => {
      state.replyingToMessageData = action.payload;
    },
    setReplyingToMessageId:(state, action: PayloadAction<string | null>)=>{
      state.replyingToMessageId = action.payload
    },
    setPinnedMessageDisplay:(state, action: PayloadAction<boolean>)=>{
      state.pinnedMessageDisplay = action.payload
    },
    setPinnedMessageData:(state, action: PayloadAction<Message | null>)=>{
      state.pinnedMessageData = action.payload
    },

  },
});

// exporting selectors
export const selectNavMenu = (state: RootState) => state.uiSlice.navMenu;
export const selectGroupChatForm = (state: RootState) =>
  state.uiSlice.newgroupChatForm;
export const selectAddMemberForm = (state: RootState) =>
  state.uiSlice.addMemberForm;
export const selectAddFriendForm = (state: RootState) =>
  state.uiSlice.addFriendForm;
export const selectFriendRequestForm = (state: RootState) =>
  state.uiSlice.friendRequestForm;
export const selectProfileForm = (state: RootState) =>
  state.uiSlice.profileForm;
export const selectRemoveMemberForm = (state: RootState) =>
  state.uiSlice.removeMemberForm;
export const selectGifForm = (state: RootState) => state.uiSlice.gifForm;
export const selectisDarkMode = (state: RootState) => state.uiSlice.isDarkMode;
export const selectAttachments = (state: RootState) =>
  state.uiSlice.attachments;
export const selectChatBar = (state: RootState) => state.uiSlice.chatBar;
export const selectChatDetailsBar = (state: RootState) =>
  state.uiSlice.chatDetailsBar;
export const selectPollForm = (state: RootState) => state.uiSlice.pollForm;
export const selectViewVotes = (state: RootState) => state.uiSlice.viewVotes;
export const selectVotesData = (state: RootState) => state.uiSlice.votesData;
export const selectChatUpdateForm = (state: RootState) =>
  state.uiSlice.chatUpdateForm;
export const selectactiveJoinedChat = (state: RootState) =>
  state.uiSlice.activeJoinedChat;
export const selectRecoverPrivateKeyForm = (state: RootState) =>
  state.uiSlice.recoverPrivateKeyForm;
export const selectSettingsForm = (state: RootState) =>
  state.uiSlice.settingsForm;
export const selectNotificationPermissionForm = (state: RootState) =>
  state.uiSlice.notificationPermissionForm;
export const selectCallDisplay = (state: RootState) => state.uiSlice.callDisplay;
export const selectIsIncomingCall = (state: RootState) => state.uiSlice.isIncomingCall;
export const selectIncomingCallInfo = (state: RootState) => state.uiSlice.incomingCallInfo;
export const selectCallHistoryTabSelected = (state: RootState) => state.uiSlice.callHistoryTabSelected;
export const selectNewMessageFormed = (state: RootState) => state.uiSlice.newMessageFormed;
export const selectReplyingToMessageData = (state: RootState) => state.uiSlice.replyingToMessageData;
export const selectReplyingToMessageId = (state:RootState) => state.uiSlice.replyingToMessageId;
export const selectPinnedMessageDisplay = (state:RootState) => state.uiSlice.pinnedMessageDisplay;
export const selectPinnedMessageData = (state:RootState) => state.uiSlice.pinnedMessageData;

// exporting actions
export const {
  setNavMenu,
  setNewgroupChatForm,
  setAddMemberForm,
  setAddFriendForm,
  setFriendRequestForm,
  setProfileForm,
  setRemoveMemberForm,
  setGifForm,
  setDarkMode,
  setAttachments,
  resetAttachments,
  setChatBar,
  setChatDetailsBar,
  setPollForm,
  setViewVotes,
  setVotesData,
  setChatUpdateForm,
  setactiveJoinedChat,
  setRecoverPrivateKeyForm,
  setSettingsForm,
  setNotificationPermissionForm,
  setCallDisplay,
  setIsIncomingCall,
  setInComingCallInfo,
  setCallHistoryTabSelected,
  setNewMessageFormed,
  setReplyingToMessageData,
  setReplyingToMessageId,
  setPinnedMessageDisplay,
  setPinnedMessageData
} = uiSlice.actions;

export default uiSlice.reducer;
