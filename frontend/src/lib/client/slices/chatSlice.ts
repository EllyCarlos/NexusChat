import { Message } from "@/interfaces/message.interface";
import { BasicUserInfo, fetchUserChatsResponse } from "@/lib/server/services/userService";
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store/store";

type InitialState = {
  selectedChatDetails: fetchUserChatsResponse | null;
  chats: fetchUserChatsResponse[];
};

const initialState: InitialState = {
  selectedChatDetails: null,
  chats:[],
};

const chatSlice = createSlice({
  name: "chatSlice",
  initialState,
  reducers: {

    updateSelectedChatDetails: (state,action: PayloadAction<fetchUserChatsResponse | null>) => {
      state.selectedChatDetails = action.payload;
    },
    updateUserTyping: (state, action: PayloadAction<BasicUserInfo>) => {
      state.selectedChatDetails?.typingUsers.push(action.payload);
    },
    removeUserTyping: (state,action: PayloadAction<fetchUserChatsResponse["id"]>) => {
      if (state.selectedChatDetails?.typingUsers.length) {
        state.selectedChatDetails.typingUsers =
          state.selectedChatDetails.typingUsers.filter(
            ({ id }) => id !== action.payload
          );
      }
    },
    updateSelectedChatMembers: (state, action: PayloadAction<{
      user: {
        id: string;
        username: string;
        avatar: string;
        isOnline: boolean;
        publicKey: string | null;
        lastSeen: Date | null;
        verificationBadge: boolean;
      };
      }[]>
    ) => {
      if (state.selectedChatDetails && state.selectedChatDetails.ChatMembers.length) {
        state.selectedChatDetails.ChatMembers.push(...action.payload);
      }
    },
    removeSelectedChatMembers: (state,action: PayloadAction<string[]>) => {
      if (state.selectedChatDetails && state.selectedChatDetails.ChatMembers.length) {
        state.selectedChatDetails.ChatMembers = state.selectedChatDetails.ChatMembers.filter(member => !action.payload.includes(member.user.id));
      }
    },
    updateChatNameOrAvatar: (state,action: PayloadAction<Partial<Pick<fetchUserChatsResponse, "avatar" | "name"> & {selectedChat?:boolean,chatId?:string}>>) => {
      const { name, avatar, selectedChat, chatId} = action.payload;

      if (selectedChat && state.selectedChatDetails) {
        if (name) state.selectedChatDetails.name = name;
        if (avatar) state.selectedChatDetails.avatar = avatar;
      }

      else if(!selectedChat && chatId){
        const chat = state.chats.find(draft => draft.id === chatId);
        if (chat) {
          if (name) chat.name = name;
          if (avatar) chat.avatar = avatar;
        }
      }
    },

    setChats:(state,action:PayloadAction<fetchUserChatsResponse[]>)=>{
      state.chats = action.payload;
    },

    updateMembersActiveStatusInChats:(state,action:PayloadAction<string[]>)=>{
      state.chats.forEach(chat => {
        chat.ChatMembers.forEach(member => {
          member.user.isOnline = action.payload.includes(member.user.id);
        });
      });
    },

    deleteChat:(state,action:PayloadAction<string>)=>{
      const chatIndex = state.chats.findIndex(chat => chat.id === action.payload);
      state.chats.splice(chatIndex,1);
    },

    updateLatestMessage:(state,action:PayloadAction<{chatId:string,newMessage:Message}>)=>{
      const chat =  state.chats.find(chat=>chat.id === action.payload.chatId);
      if(chat){
        chat.latestMessage = action.payload.newMessage;
      }
    },

    updateUnreadMessagesAsSeen:(state,action:PayloadAction<{userId:string,loggedInUserId:string,chatId:string}>)=>{

      const {loggedInUserId,userId,chatId} = action.payload;

      const isOwnMessageSeenUpdate = userId === loggedInUserId;

      const chat = state.chats.find((draft) => draft.id === chatId);

      if (chat && isOwnMessageSeenUpdate && chat.UnreadMessages.length > 0 && chat.UnreadMessages[0]?.count){
        chat.UnreadMessages[0].count = 0;
      } 

    },

    updateUnreadMessages:(state,action:PayloadAction<{
      chatId:string,
      message?:{
        textMessageContent?:string | undefined | null
        url?:boolean | undefined | null
        attachments?:boolean
        poll?:boolean
        audio?:boolean
        createdAt:Date
      },
      sender:{
        id:string,
        avatar:string,
        username:string
      }
    }>)=>{

        const {chatId,message,sender} = action.payload;

        // find the chat in which the message has came
        const chat = state.chats.find((draft) => draft.id === chatId);

        // if valid chat id
        if (chat) {

          if(chat.UnreadMessages.length === 0){

            chat.UnreadMessages.push({
              count:1,
              message:{
                createdAt: new Date(),
                attachments: [{secureUrl:"demo-url"}],
                isTextMessage: true,
                textMessageContent: message?.textMessageContent || null,
                isPollMessage: message?.poll || false,
                url: message?.url ? 'asdf' : null,
                audioUrl: message?.audio ? 'audio-url' : null,
              },
              sender
            });

          }
          else{
            // firstly increment the unread message count
            chat.UnreadMessages[0].count += 1;

            // update the sender of the unread message
            chat.UnreadMessages[0].sender = sender;

            if (message?.poll) chat.UnreadMessages[0].message.isPollMessage = true;
            else if (message?.textMessageContent?.length) chat.UnreadMessages[0].message.textMessageContent = message.textMessageContent;
            else if (message?.attachments) chat.UnreadMessages[0].message.attachments = [{secureUrl:"demo-url"}];
            else if (message?.url) chat.UnreadMessages[0].message.url = 'yes it is a gif';
            else if(message?.audio) chat.UnreadMessages[0].message.audioUrl = 'audio-url';
          }
        }

    },

    updateUserTypingInChats:(state,action:PayloadAction<{
      chatId:string,
      user:{
        id:string
        username:string
        avatar:string
      }
    }>)=>{

      const {chatId,user} = action.payload;

      const chat = state.chats.find(draft => draft.id === chatId);
      if (chat) {
        const isUserAlreadyTyping = chat.typingUsers.some(typingUser => typingUser.id === user.id);
        if (!isUserAlreadyTyping) {
          chat.typingUsers.push(user);
        }
      }
    },

    removeUserTypingFromChats:(state,action:PayloadAction<{chatId:string,userId:string}>)=>{
        const {chatId,userId} = action.payload;
        const chat = state.chats.find(draft => draft.id === chatId);
        if (chat) {
          chat.typingUsers = chat.typingUsers.filter(typingUser => typingUser.id !== userId);
        }
    },

    updateOfflineStatusOfMembersInChats:(state,action:PayloadAction<{userId:string}>)=>{

      const {userId} = action.payload;

      state.chats.map(chat => {
        const user = chat.ChatMembers.find(member => member.user.id === userId)?.user;
        if (user){
          user.isOnline = false;
          user.lastSeen = new Date();
        }
      });

      state.selectedChatDetails?.ChatMembers.map(member=>{
        if(member.user.id === userId){
          member.user.isOnline = false;
          member.user.lastSeen = new Date();
        }
      });
    },

    updateOnlineStatusOfMembersInChats:(state,action:PayloadAction<{userId:string}>)=>{

      const {userId} = action.payload;
      state.chats.map(chat => {
        const user = chat.ChatMembers.find(member => member.user.id === userId)?.user;
        if (user)  user.isOnline = true;
      });
      state.selectedChatDetails?.ChatMembers.map(member=>{
        if(member.user.id === userId){
          member.user.isOnline = true;
        }
      });
    },

    addNewChat:(state,action:PayloadAction<{newChat:fetchUserChatsResponse}>)=>{
      state.chats.push(action.payload.newChat);
    },

    updateChatMembers:(state,action:PayloadAction<{chatId:string,members:fetchUserChatsResponse['ChatMembers']}>)=>{

      const {chatId,members} = action.payload;
      const chat = state.chats.find(draft => draft.id === chatId);

      if (chat) chat.ChatMembers.push(...members)
    },

    removeChatMembers:(state,action:PayloadAction<{chatId:string,membersIds:string[]}>)=>{
        const {chatId,membersIds} = action.payload;
        const chat = state.chats.find(draft => draft.id === chatId);
        if(chat) chat.ChatMembers = chat.ChatMembers.filter(member => !membersIds.includes(member.user.id));
    },

    addNewPinnedMessage:(state,action:PayloadAction<{
      message: Message
      id: string;
      createdAt: Date;
      updatedAt: Date;
    }>)=>{
      if(state.selectedChatDetails && state.selectedChatDetails.id === action.payload.message.chatId){
        state.selectedChatDetails.PinnedMessages.push(action.payload as any);
      }
      state.chats.forEach(chat=>{
        if(chat.id === action.payload.message.chatId){
          chat.PinnedMessages.push(action.payload as any);
        }
      })
    },

    removePinnedMessage:(state,action:PayloadAction<{pinId:string}>)=>{
      if(state.selectedChatDetails){
        state.selectedChatDetails.PinnedMessages = state.selectedChatDetails.PinnedMessages.filter(pin => pin.id !== action.payload.pinId);
      }
      state.chats.forEach(chat=>{
        chat.PinnedMessages = chat.PinnedMessages.filter(pin => pin.id !== action.payload.pinId);
      })
    },


    deletePinnedMessageOnMessageDeletion:(state,action:PayloadAction<{messageId:string,chatId:string}>)=>{

      if(state.selectedChatDetails?.id === action.payload.chatId){
        state.selectedChatDetails.PinnedMessages = state.selectedChatDetails.PinnedMessages.filter(pinMessage=>pinMessage.message.id != action.payload.messageId)
      }

      state.chats.forEach(chat=>{
        if(chat.id === action.payload.chatId){
          chat.PinnedMessages = chat.PinnedMessages.filter(pinMessages=>pinMessages.message.id != action.payload.messageId)
        }
      })
    },
  },
});

// exporting selector
export const selectSelectedChatDetails = (state: RootState) => state.chatSlice.selectedChatDetails;
export const selectChats = (state: RootState) => state.chatSlice.chats;

// exporting actions
export const {
  updateSelectedChatDetails,
  updateUserTyping,
  removeUserTyping,
  updateSelectedChatMembers,
  removeSelectedChatMembers,
  updateChatNameOrAvatar,
  updateMembersActiveStatusInChats,
  setChats,
  deleteChat,
  updateLatestMessage,
  updateUnreadMessagesAsSeen,
  updateUnreadMessages,
  updateUserTypingInChats,
  removeUserTypingFromChats,
  updateOfflineStatusOfMembersInChats,
  updateOnlineStatusOfMembersInChats,
  addNewChat,
  updateChatMembers,
  removeChatMembers,
  addNewPinnedMessage,
  removePinnedMessage,
  deletePinnedMessageOnMessageDeletion
} = chatSlice.actions;

export default chatSlice;
