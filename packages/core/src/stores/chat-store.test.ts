import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  deleteThread: vi.fn(),
  getThreads: vi.fn(),
  insertMessage: vi.fn(),
  replaceMessageHistory: vi.fn(),
  insertThread: vi.fn(),
  updateThreadTitle: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

const { getChatStreamingKey, useChatStore } = await import("./chat-store");

function resetChatStore() {
  useChatStore.setState({
    threads: [],
    generalActiveThreadId: null,
    bookActiveThreadIds: {},
    isStreaming: false,
    streamingContent: "",
    streamingSessions: {},
    toolCalls: [],
    reasoning: [],
    currentStep: "idle",
    semanticContext: null,
    initialized: false,
  });
}

describe("useChatStore streaming sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChatStore();
  });

  it("历史替换提交失败不更改内存，成功才一起替换历史和摘要", async () => {
    const message = {
      id: "old",
      threadId: "thread",
      role: "user" as const,
      content: "old",
      createdAt: 1,
    };
    const thread = {
      id: "thread",
      title: "test",
      createdAt: 1,
      updatedAt: 1,
      messages: [message],
      memorySummary: "old memory",
      memoryUpdatedAt: 1,
      memoryMessageCount: 1,
    };
    useChatStore.setState({ threads: [thread] });
    dbMocks.replaceMessageHistory.mockRejectedValueOnce(new Error("write failed"));
    const replacement = { ...message, id: "new", content: "edited" };
    await expect(
      useChatStore.getState().replaceMessageHistory("thread", "old", replacement),
    ).rejects.toThrow("write failed");
    expect(useChatStore.getState().threads[0]).toEqual(thread);
    dbMocks.replaceMessageHistory.mockResolvedValueOnce({ messages: [replacement], updatedAt: 2 });
    await useChatStore.getState().replaceMessageHistory("thread", "old", replacement);
    expect(useChatStore.getState().threads[0]).toEqual({
      ...thread,
      messages: [replacement],
      updatedAt: 2,
      memorySummary: undefined,
      memoryUpdatedAt: undefined,
      memoryMessageCount: 0,
    });
  });

  it("stores and updates a book-scoped streaming message", () => {
    const key = getChatStreamingKey("book-1");
    const message = {
      id: "msg-1",
      threadId: "thread-1",
      role: "assistant" as const,
      parts: [],
      createdAt: 100,
    };

    useChatStore.getState().startStreamingSession({
      key,
      threadId: "thread-1",
      bookId: "book-1",
      isStreaming: true,
      currentMessage: message,
      currentStep: "thinking",
      errorMessage: null,
      startedAt: 100,
      updatedAt: 100,
    });

    expect(useChatStore.getState().streamingSessions[key]?.currentMessage).toBe(message);
    expect(useChatStore.getState().isStreaming).toBe(true);

    const updatedMessage = {
      ...message,
      parts: [
        {
          id: "text-1",
          type: "text" as const,
          text: "hello",
          status: "running" as const,
          createdAt: 101,
        },
      ],
    };
    useChatStore.getState().updateStreamingSession(key, {
      currentMessage: updatedMessage,
      currentStep: "responding",
    });

    expect(useChatStore.getState().streamingSessions[key]?.currentMessage).toBe(updatedMessage);
    expect(useChatStore.getState().streamingSessions[key]?.currentStep).toBe("responding");

    useChatStore.getState().finishStreamingSession(key);

    expect(useChatStore.getState().streamingSessions[key]).toBeUndefined();
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().currentStep).toBe("idle");
  });

  it("keeps global streaming true while another session is active", () => {
    const generalKey = getChatStreamingKey();
    const bookKey = getChatStreamingKey("book-1");
    const baseSession = {
      threadId: "thread-1",
      isStreaming: true,
      currentMessage: null,
      currentStep: "thinking" as const,
      startedAt: 100,
      updatedAt: 100,
    };

    useChatStore.getState().startStreamingSession({ ...baseSession, key: generalKey });
    useChatStore
      .getState()
      .startStreamingSession({ ...baseSession, key: bookKey, bookId: "book-1" });

    useChatStore.getState().finishStreamingSession(generalKey);

    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessions[bookKey]).toBeDefined();
  });
});
