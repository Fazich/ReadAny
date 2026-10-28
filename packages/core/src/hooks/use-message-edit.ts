import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachedQuote } from "../types/chat";
import type { MessageV2 } from "../types/message";
import { extractEditableMessage } from "../utils/chat-utils";

/** 管理编辑目标和引用快照；正文、选项和焦点由平台 ChatInput 保存与恢复。 */
export function useMessageEdit(
  threadId: string | null | undefined,
  bookId: string | undefined,
  stopStream: () => void | Promise<void>,
  quotes: AttachedQuote[],
  setQuotes: (quotes: AttachedQuote[]) => void,
) {
  const [editMessage, setEditMessage] = useState<MessageV2 | null>(null);
  const originalQuotes = useRef<AttachedQuote[] | null>(null);
  const setQuotesRef = useRef(setQuotes);
  setQuotesRef.current = setQuotes;
  const session = useRef<object>({});
  const context = useRef({ threadId, bookId, mounted: true, version: 0 });
  const previous = context.current;
  context.current = {
    threadId,
    bookId,
    mounted: previous.mounted,
    version:
      previous.threadId === threadId && previous.bookId === bookId
        ? previous.version
        : previous.version + 1,
  };
  useEffect(() => {
    context.current.mounted = true;
    return () => {
      context.current.mounted = false;
    };
  }, []);

  const cancelEdit = useCallback(() => {
    session.current = {};
    setEditMessage(null);
    if (originalQuotes.current) setQuotesRef.current(originalQuotes.current);
    originalQuotes.current = null;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 会话或书籍变化时退出编辑。
  useEffect(() => {
    if (originalQuotes.current) cancelEdit();
  }, [threadId, bookId, cancelEdit]);

  const startEdit = useCallback(
    (message: MessageV2) => {
      if (message.role !== "user" || message.threadId !== threadId) return;
      // 立即允许回填；提交时再次等待停止及终态保存完成。
      try {
        void Promise.resolve(stopStream()).catch((error) =>
          console.error("[Chat] Failed to stop stream:", error),
        );
      } catch (error) {
        console.error("[Chat] Failed to stop stream:", error);
      }
      if (!originalQuotes.current) originalQuotes.current = [...quotes];
      session.current = {};
      setEditMessage({ ...message });
      setQuotes(extractEditableMessage(message).quotes);
    },
    [quotes, setQuotes, stopStream, threadId],
  );

  const captureSubmission = useCallback(() => {
    const token = session.current;
    const version = context.current.version;
    const isCurrent = () =>
      context.current.mounted &&
      context.current.version === version &&
      context.current.threadId === threadId &&
      context.current.bookId === bookId &&
      session.current === token;
    const canAccept = (acceptedThreadId?: string) =>
      context.current.mounted &&
      context.current.bookId === bookId &&
      session.current === token &&
      ((context.current.version === version && context.current.threadId === threadId) ||
        (!threadId &&
          context.current.version === version + 1 &&
          context.current.threadId === acceptedThreadId));
    return {
      isCurrent,
      canAccept,
      editTarget: editMessage
        ? { threadId: editMessage.threadId, messageId: editMessage.id, isCurrent }
        : undefined,
      accepted: (acceptedThreadId?: string) => {
        if (!canAccept(acceptedThreadId)) return;
        originalQuotes.current = null;
        setEditMessage(null);
      },
    };
  }, [bookId, editMessage, threadId]);

  return { editMessage, startEdit, cancelEdit, captureSubmission };
}
