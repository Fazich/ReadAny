/**
 * @readany/core hooks — barrel export
 */
export { useMessageEdit } from "./use-message-edit";
export { useChatSubmit } from "./use-chat-submit";
export { useDebounce } from "./use-debounce";
export { useDrag } from "./use-drag";
export { useThrottledValue, useThrottledCallback, useStreamingText } from "./use-throttled-value";
export { useKeyboard } from "./use-keyboard";
export { useTranslator, type UseTranslatorOptions } from "./useTranslator";
export {
  useChapterTranslation,
  type ChapterTranslationState,
  type UseChapterTranslationOptions,
} from "./useChapterTranslation";
export {
  useReadingSession,
  setSessionEventSource,
  webSessionEventSource,
  type SessionEventSource,
} from "./use-reading-session";
export {
  useStreamingChat,
  type StreamingChatOptions,
  type StreamingState,
} from "./use-streaming-chat";

// Reader hooks
export {
  type FoliateView,
  wrappedFoliateView,
  useFoliateEvents,
  type FoliateEventHandlers,
  usePagination,
  useBookShortcuts,
} from "./reader";
