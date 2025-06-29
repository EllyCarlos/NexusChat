export enum Event {
  MESSAGE="MESSAGE",
  NEW_CHAT="NEW_CHAT",
  MESSAGE_SEEN="MESSAGE_SEEN",
  MESSAGE_DELETE = "MESSAGE_DELETE",
  GROUP_CHAT_UPDATE="GROUP_CHAT_UPDATE",
  USER_TYPING="USER_TYPING",
  UNREAD_MESSAGE="UNREAD_MESSAGE",
  NEW_FRIEND_REQUEST="NEW_FRIEND_REQUEST",
  NEW_MEMBER_ADDED="NEW_MEMBER_ADDED",
  ONLINE_USER="ONLINE_USER",
  OFFLINE_USER="OFFLINE_USER",
  MESSAGE_EDIT="MESSAGE_EDIT",
  DELETE_CHAT="DELETE_CHAT",
  MEMBER_REMOVED="MEMBER_REMOVED",
  VOTE_IN="VOTE_IN",
  VOTE_OUT="VOTE_OUT",
  ONLINE_USERS_LIST="ONLINE_USERS_LIST",
  NEW_REACTION = "NEW_REACTION",
  DELETE_REACTION = "DELETE_REACTION",
  CALL_USER = "CALL_USER",
  INCOMING_CALL = "INCOMING_CALL",
  CALL_ACCEPTED = "CALL_ACCEPTED",
  NEGO_NEEDED = "NEGO_NEEDED",
  NEGO_DONE = "NEGO_DONE",
  NEGO_FINAL = "NEGO_FINAL",
  CALLEE_OFFLINE = "CALLEE_OFFLINE",
  CALLEE_BUSY = "CALLEE_BUSY",
  CALL_END = "CALL_END",
  CALL_REJECTED = "CALL_REJECTED",
  CALLER_OFFLINE = "CALLER_OFFLINE",
  ICE_CANDIDATE = "ICE_CANDIDATE",
  CALL_ID = "CALL_ID",
  PIN_MESSAGE = "PIN_MESSAGE",
  UNPIN_MESSAGE = "UNPIN_MESSAGE",
  PIN_LIMIT_REACHED = "PIN_LIMIT_REACHED",
}