/**
 * ChatInput — sageread-style rounded card input with deep thinking option
 * Supports attached context quotes that display as chips above the textarea.
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AttachedQuote, MessageV2 } from "@readany/core/types";
import { extractEditableMessage } from "@readany/core/utils";
import { Brain, EyeOff, Quote, Send, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
export type { AttachedQuote };

interface ChatInputProps {
  onSend: (
    content: string,
    deepThinking?: boolean,
    spoilerFree?: boolean,
    quotes?: AttachedQuote[],
    onAccepted?: () => void,
  ) => void | Promise<void>;
  editMessage?: MessageV2 | null;
  onCancelEdit?: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  showDeepThinking?: boolean;
  quotes?: AttachedQuote[];
  onRemoveQuote?: (id: string) => void;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  showDeepThinking = true,
  quotes = [],
  onRemoveQuote,
  editMessage,
  onCancelEdit,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [deepThinking, setDeepThinking] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const draftSnapshot = useRef<{
    value: string;
    deepThinking: boolean;
    spoilerFree: boolean;
  } | null>(null);
  const inputVersion = useRef<object>({});
  // 只在编辑目标改变时保存或恢复快照，输入变化不能覆盖进入前的草稿。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 编辑目标定义快照生命周期。
  useEffect(() => {
    inputVersion.current = {};
    submittingRef.current = false;
    setIsSubmitting(false);
    if (editMessage) {
      draftSnapshot.current ??= { value, deepThinking, spoilerFree };
      setValue(extractEditableMessage(editMessage).content);
      textareaRef.current?.focus();
    } else if (draftSnapshot.current) {
      const snapshot = draftSnapshot.current;
      setValue(snapshot.value);
      setDeepThinking(snapshot.deepThinking);
      setSpoilerFree(snapshot.spoilerFree);
      draftSnapshot.current = null;
    }
  }, [editMessage]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = value ? `${Math.min(el.scrollHeight, 160)}px` : "auto";
  }, [value]);
  useEffect(
    () => () => {
      inputVersion.current = {};
    },
    [],
  );

  const resolvedPlaceholder = placeholder || t("chat.askPlaceholder");

  const handleSend = useCallback(
    async (useDeepThinking: boolean = deepThinking) => {
      const trimmed = value.trim();
      if (
        disabled ||
        (isStreaming && !editMessage) ||
        submittingRef.current ||
        (!trimmed && quotes.length === 0)
      )
        return;
      submittingRef.current = true;
      setIsSubmitting(true);
      const version = inputVersion.current;
      try {
        await onSend(
          trimmed,
          useDeepThinking,
          spoilerFree,
          quotes.length > 0 ? quotes : undefined,
          () => {
            if (inputVersion.current !== version) return;
            draftSnapshot.current = null;
            setValue("");
            setDeepThinking(false);
            setSpoilerFree(false);
          },
        );
      } catch (error) {
        console.error("[ChatInput] Failed to send message:", error);
      } finally {
        if (inputVersion.current === version) {
          submittingRef.current = false;
          setIsSubmitting(false);
        }
      }
    },
    [value, deepThinking, spoilerFree, onSend, quotes, disabled, isStreaming, editMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const toggleDeepThinking = useCallback(() => {
    setDeepThinking((prev) => !prev);
  }, []);

  const toggleSpoilerFree = useCallback(() => {
    setSpoilerFree((prev) => !prev);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative rounded-2xl border bg-background shadow-around">
        {editMessage && (
          <div className="flex items-start justify-between gap-2 px-4 pt-3 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">{t("chat.editingMessage")}</p>
              <p>{t("chat.editMessageWarning")}</p>
            </div>
            <button
              type="button"
              onClick={onCancelEdit}
              className="shrink-0 rounded px-2 py-1 hover:bg-muted"
            >
              {t("chat.cancelEdit")}
            </button>
          </div>
        )}
        {/* Attached quotes chips */}
        {quotes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            <TooltipProvider delayDuration={300}>
              {quotes.map((q) => (
                <Tooltip key={q.id}>
                  <TooltipTrigger asChild>
                    <span className="group inline-flex max-w-[200px] items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs text-primary">
                      <Quote className="size-3 shrink-0 opacity-60" />
                      <span className="truncate">{q.text}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveQuote?.(q.id);
                        }}
                        className="ml-0.5 shrink-0 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-xs whitespace-pre-wrap bg-popover text-popover-foreground border shadow-md"
                  >
                    <p className="text-xs leading-relaxed">
                      {q.text.length > 300 ? `${q.text.slice(0, 300)}...` : q.text}
                    </p>
                    {q.source && (
                      <p className="mt-1 text-[10px] text-muted-foreground">— {q.source}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={quotes.length > 0 ? t("chat.askAboutQuote") : resolvedPlaceholder}
          disabled={disabled || isSubmitting}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ minHeight: 36, maxHeight: 160 }}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1">
            {showDeepThinking && (
              <button
                type="button"
                onClick={toggleDeepThinking}
                disabled={isSubmitting}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                  deepThinking
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Brain className="size-3" />
                <span>{t("chat.deepThinking")}</span>
              </button>
            )}
            {showDeepThinking && (
              <button
                type="button"
                onClick={toggleSpoilerFree}
                disabled={isSubmitting}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                  spoilerFree
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <EyeOff className="size-3" />
                <span>{t("chat.spoilerFree")}</span>
              </button>
            )}
          </div>
          {isStreaming && !editMessage ? (
            <button
              type="button"
              onClick={onStop}
              className="flex size-7 items-center justify-center rounded-full border border-destructive/20 bg-destructive text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
            >
              <Square className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || isSubmitting || (!value.trim() && quotes.length === 0)}
              aria-label={t(editMessage ? "chat.resend" : "chat.send")}
              title={t(editMessage ? "chat.resend" : "chat.send")}
              onClick={() => handleSend()}
              className={`flex h-7 min-w-7 items-center justify-center rounded-full transition-colors ${
                value.trim() || quotes.length > 0
                  ? "border border-primary/20 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  : "border border-border bg-background text-muted-foreground hover:bg-muted"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {editMessage ? (
                <span className="whitespace-nowrap px-1 text-xs">{t("chat.resend")}</span>
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      {deepThinking && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {t("chat.deepThinkingHint")}
        </p>
      )}
      {spoilerFree && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {t("chat.spoilerFreeHint")}
        </p>
      )}
    </div>
  );
}
