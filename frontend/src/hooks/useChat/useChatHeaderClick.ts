import { useToggleChatDetailsBar } from "../useUI/useToggleChatDetailsBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

export const useChatHeaderClick = () => {
  const is2xl = useMediaQuery(1536);
  const { toggleChatDetailsBar } = useToggleChatDetailsBar();

  const handleChatHeaderClick = () => {
    if (is2xl) {
      toggleChatDetailsBar();
    }
  };

  return { handleChatHeaderClick };
};
