import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  editMessage: vi.fn<(messageId: string, updatedContent: string) => Promise<boolean>>(),
  sendMessage: vi.fn<(message: string) => Promise<boolean>>(),
  state: {
    uiSlice: { replyingToMessageData: "reply preview" as string | null },
  },
}));

vi.mock("@/hooks/useMessages/useSendMessage", () => ({
  useSendMessage: () => ({ sendMessage: mocks.sendMessage }),
}));

vi.mock("@/hooks/useMessages/useEditMessage", () => ({
  useEditMessage: () => ({ editMessage: mocks.editMessage }),
}));

vi.mock("@/lib/client/store/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));

import {
  setReplyingToMessageData,
  setReplyingToMessageId,
} from "@/lib/client/slices/uiSlice";
import { useHandleEditMessageSubmit } from "@/hooks/useMessages/useHandleEditMessageSubmit";
import { useHandleSendMessage } from "@/hooks/useMessages/useHandleSendMessage";

const createSubmitEvent = () => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
}) as unknown as React.FormEvent<HTMLFormElement>;

describe("message submit handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.uiSlice.replyingToMessageData = "reply preview";
  });

  describe("send", () => {
    it("awaits a successful send before clearing the draft and reply state", async () => {
      let resolveSend!: (sent: boolean) => void;
      mocks.sendMessage.mockReturnValue(new Promise((resolve) => {
        resolveSend = resolve;
      }));
      const setMessageVal = vi.fn();
      const event = createSubmitEvent();
      const { handleMessageSubmit } = useHandleSendMessage({
        messageVal: "private message",
        setMessageVal,
      });

      const submission = handleMessageSubmit(event);

      expect(mocks.sendMessage).toHaveBeenCalledWith("private message");
      expect(setMessageVal).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();

      resolveSend(true);
      await submission;

      expect(setMessageVal).toHaveBeenCalledWith("");
      expect(mocks.dispatch).toHaveBeenNthCalledWith(
        1,
        setReplyingToMessageData(null),
      );
      expect(mocks.dispatch).toHaveBeenNthCalledWith(
        2,
        setReplyingToMessageId(null),
      );
    });

    it("preserves the draft and reply state after failure so the send can be retried", async () => {
      mocks.sendMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const setMessageVal = vi.fn();
      const { handleMessageSubmit } = useHandleSendMessage({
        messageVal: "private message",
        setMessageVal,
      });

      await handleMessageSubmit(createSubmitEvent());

      expect(setMessageVal).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();

      await handleMessageSubmit(createSubmitEvent());

      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
      expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, "private message");
      expect(setMessageVal).toHaveBeenCalledWith("");
      expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe("edit", () => {
    it("awaits a successful edit before closing the edit state", async () => {
      let resolveEdit!: (updated: boolean) => void;
      mocks.editMessage.mockReturnValue(new Promise((resolve) => {
        resolveEdit = resolve;
      }));
      const setEditMessageId = vi.fn();
      const setOpenContextMenuMessageId = vi.fn();
      const event = createSubmitEvent();
      const { handleEditMessageSubmit } = useHandleEditMessageSubmit({
        messageId: "message-id",
        updatedContentValue: "  edited private message  ",
        setEditMessageId,
        setOpenContextMenuMessageId,
      });

      const submission = handleEditMessageSubmit(event);

      expect(mocks.editMessage).toHaveBeenCalledWith(
        "message-id",
        "edited private message",
      );
      expect(setEditMessageId).not.toHaveBeenCalled();
      expect(setOpenContextMenuMessageId).not.toHaveBeenCalled();

      resolveEdit(true);
      await submission;

      expect(setEditMessageId).toHaveBeenCalledWith("");
      expect(setOpenContextMenuMessageId).toHaveBeenCalledWith("");
    });

    it("preserves edit state and content after failure so the edit can be retried", async () => {
      mocks.editMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const setEditMessageId = vi.fn();
      const setOpenContextMenuMessageId = vi.fn();
      const { handleEditMessageSubmit } = useHandleEditMessageSubmit({
        messageId: "message-id",
        updatedContentValue: "edited private message",
        setEditMessageId,
        setOpenContextMenuMessageId,
      });

      await handleEditMessageSubmit(createSubmitEvent());

      expect(setEditMessageId).not.toHaveBeenCalled();
      expect(setOpenContextMenuMessageId).not.toHaveBeenCalled();

      await handleEditMessageSubmit(createSubmitEvent());

      expect(mocks.editMessage).toHaveBeenCalledTimes(2);
      expect(mocks.editMessage).toHaveBeenNthCalledWith(
        2,
        "message-id",
        "edited private message",
      );
      expect(setEditMessageId).toHaveBeenCalledWith("");
      expect(setOpenContextMenuMessageId).toHaveBeenCalledWith("");
    });
  });
});
