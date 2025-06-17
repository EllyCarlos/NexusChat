import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import {
  getAppropriateLastLatestMessageForGroupChats,
  getAppropriateLastLatestMessageForPrivateChats,
  getAppropriateUnreadMessageForGroupChats,
  getAppropriateUnreadMessageForPrivateChats,
} from "@/lib/shared/helpers";
import { DisplayDecryptedMessage } from "../messages/DisplayDecryptedMessage";
import { TypingIndicatorAnimation } from "../ui/TypingIndicatorAnimation";

type PropTypes = {
  chat: fetchUserChatsResponse;
};

export const ChatListItemSecondaryInfo = ({ chat }: PropTypes) => {

  const renderHelper = () => {
    if (chat.typingUsers.length > 0) {
      // if any user is typing
      // then show typing indicator animation
      return (
        <div className="w-14 bg-secondary-dark rounded-full">
          <TypingIndicatorAnimation />
        </div>
      );
    }
    else if (chat.UnreadMessages.length > 0 && chat.UnreadMessages[0]?.count === 0) {
      // that means are no unread messages
      // so we will display the last latest message of the conversation

      if (chat.isGroupChat) {
        // if it is a group chat
        // then messages are not in encrypted format
        // so if there is a gif we can show "sent a gif" or for attachments "sent an attachment" and so on
        // and for text messages we can direclty show the message right?
        return (
          <span className="text-sm text-secondary-darker">
            {getAppropriateLastLatestMessageForGroupChats(chat.latestMessage)}
          </span>
        );
      }
      else {
        // if is is not a group chat
        // then for last latest text messages we have to decrypt the message, then only we can show that
        // as in private chats E2EE(end-to-end-enncrytion) is applied
        if (chat.latestMessage?.isTextMessage) {
          // here we will decrypt the message and then show it
          return (
            <span className="text-sm text-secondary-darker">
              <DisplayDecryptedMessage
                cipherText={chat.latestMessage.textMessageContent!}
                chat={chat}
              />
            </span>
          );
        } else {
          // but if the latest message is not a text message
          // we can use our utility function to get the appropriate message
          return (
            <span className="text-sm text-secondary-darker">
              {getAppropriateLastLatestMessageForPrivateChats(chat.latestMessage)}
            </span>
          );
        }
      }
    }
    else {
      // if there are unread messages
      // then we cannot show the latest message as we have to show the latest unread message
      // again there are two cases
      if (chat.isGroupChat) {
        // if it is group chat
        // then we can just simply use our utility function to get the appropriate message
        // and text messages are not encrypted in group chats
        return (
          <span className="text-sm text-secondary-darker">
            {getAppropriateUnreadMessageForGroupChats(chat.UnreadMessages)}
          </span>
        );
      }
      else {
        // if it is not a group chat
        // and the unreadMessage is a textMessage then we have to decrypt the message first as private chats are E2EE
        if (chat.UnreadMessages.length>0 && chat.UnreadMessages[0]?.message?.isTextMessage) {
          // here will have to decrypt the message
          // and then only we can show it
          return (
            <span className="text-sm text-secondary-darker">
              <DisplayDecryptedMessage
                cipherText={chat.UnreadMessages[0].message.textMessageContent!}
                chat={chat}
              />
            </span>
          );
        } else {
          // but if the unread message is not a text message
          // then we can use our utility function to get the appropriate message
          return (
            <span className="text-sm text-secondary-darker">
              {getAppropriateUnreadMessageForPrivateChats(chat.UnreadMessages)}
            </span>
          );
        }
      }
    }
  };

  return (
    <div className="flex justify-between items-center shrink-0">
      <div className=" w-full h-full">{renderHelper()}</div>
      {chat.UnreadMessages.length>0 && chat.UnreadMessages[0]?.count > 0 && (
        <p className="bg-primary flex items-center justify-center text-white rounded-full h-5 w-5 p-2">
          {chat.UnreadMessages[0].count}
        </p>
      )}
    </div>
  );
};
