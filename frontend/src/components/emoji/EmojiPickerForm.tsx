'use client';
import EmojiPicker, {
  EmojiClickData,
  EmojiStyle,
  Theme,
} from "emoji-picker-react";
import { useMediaQuery } from "../../hooks/useUtils/useMediaQuery";
import { selectisDarkMode } from "../../lib/client/slices/uiSlice";
import { useAppSelector } from "../../lib/client/store/hooks";

type PropTypes = {
  onEmojiClick: (e: EmojiClickData) => void;
  width?: number;
  height?: number;
  reactionsDefaultOpen?: boolean;
};

export const EmojiPickerForm = ({
  onEmojiClick,
  reactionsDefaultOpen = false,
}: PropTypes) => {
  const isDarkMode = useAppSelector(selectisDarkMode);
  const is375 = useMediaQuery(375);

  return (
    <EmojiPicker
      emojiStyle={EmojiStyle.APPLE}
      reactionsDefaultOpen={reactionsDefaultOpen}
      onEmojiClick={onEmojiClick}
      onReactionClick={onEmojiClick}
      theme={isDarkMode ? Theme.DARK : Theme.LIGHT}
      width={is375 ? 305 : 350}
      autoFocusSearch={false}
      height={450}
    />
  );
};
