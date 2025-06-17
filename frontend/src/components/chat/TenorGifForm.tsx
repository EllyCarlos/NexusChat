import GifPicker, { TenorImage, Theme } from "gif-picker-react";
import { useSendMessage } from "../../hooks/useMessages/useSendMessage";
import { useToggleGif } from "../../hooks/useUI/useToggleGif";
import { selectisDarkMode, setReplyingToMessageData, setReplyingToMessageId } from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";
import { useCallback } from "react";

const TenorGifForm = () => {
  const { sendMessage } = useSendMessage();
  const isDarkMode = useAppSelector(selectisDarkMode);
  const { toggleGifForm } = useToggleGif();

  const dispatch = useAppDispatch();

  const handleGifClick = useCallback((image: TenorImage) => {
    toggleGifForm();
    sendMessage(undefined, image.url);
    dispatch(setReplyingToMessageData(null));
    dispatch(setReplyingToMessageId(null));
  },[dispatch, sendMessage, toggleGifForm]);

  const tenorApiKey = process.env.NEXT_PUBLIC_TENOR_API_KEY;

  return (
    <div className="w-[35rem] h-[35rem] max-xl:w-[30rem] max-sm:w-[100%] max-sm:h-[30rem]">
      {tenorApiKey && (
        <GifPicker
          onGifClick={handleGifClick}
          theme={isDarkMode ? Theme.DARK : Theme.LIGHT}
          tenorApiKey={tenorApiKey}
          width={"100%"}
          height={"100%"}
          country="IN"
          categoryHeight={"8rem"}
        />
      )}
    </div>
  );
};

export default TenorGifForm;
