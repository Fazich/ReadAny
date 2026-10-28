import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { AIConfig, AttachedQuote } from "../types/chat";
import { useMessageEdit } from "./use-message-edit";
import type { useStreamingChat } from "./use-streaming-chat";

interface ChatSubmitOptions {
  threadId: string | null | undefined;
  bookId?: string;
  quotes: AttachedQuote[];
  setQuotes: Dispatch<SetStateAction<AttachedQuote[]>>;
  sendMessage: ReturnType<typeof useStreamingChat>["sendMessage"];
  stopStream: () => void | Promise<void>;
  resolveConfig: () => AIConfig | null | Promise<AIConfig | null>;
  onConfigRequired: () => void;
  onError: (error: unknown) => void;
}

/** 平台提供配置和提示；共享层负责提交时序以及接受后的编辑、引用消费。 */
export function useChatSubmit({
  threadId,
  bookId,
  quotes,
  setQuotes,
  sendMessage,
  stopStream,
  resolveConfig,
  onConfigRequired,
  onError,
}: ChatSubmitOptions) {
  const edit = useMessageEdit(threadId, bookId, stopStream, quotes, setQuotes);
  const { captureSubmission } = edit;
  const handleSend = useCallback(
    async (
      content: string,
      deepThinking = false,
      spoilerFree = false,
      sentQuotes?: AttachedQuote[],
      onAccepted?: () => void,
    ) => {
      const submission = captureSubmission();
      // 在配置解析、停止等待前固定引用，接受时不消费期间新追加的引用。
      const quoteSnapshot = sentQuotes?.map((quote) => ({ ...quote }));
      const sentIds = new Set(quoteSnapshot?.map((quote) => quote.id));
      let accepted = false;
      try {
        const config = await resolveConfig();
        if (!submission.isCurrent()) return;
        if (!config) {
          onConfigRequired();
          return;
        }
        if (submission.editTarget) await stopStream();
        if (!submission.isCurrent()) return;
        await sendMessage(
          content,
          bookId,
          deepThinking,
          spoilerFree,
          quoteSnapshot,
          config,
          (acceptedThreadId) => {
            if (accepted || !submission.canAccept(acceptedThreadId)) return;
            accepted = true;
            // 先让输入丢弃正文快照，再退出编辑，避免恢复已经发送的草稿。
            onAccepted?.();
            setQuotes((current) => current.filter((quote) => !sentIds.has(quote.id)));
            submission.accepted(acceptedThreadId);
          },
          submission.editTarget,
        );
      } catch (error) {
        if (submission.isCurrent()) onError(error);
      }
    },
    [
      bookId,
      captureSubmission,
      onConfigRequired,
      onError,
      resolveConfig,
      sendMessage,
      setQuotes,
      stopStream,
    ],
  );

  return { edit, handleSend };
}
