import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig } from "../types";

const boundaries = vi.hoisted(() => ({
  db: {
    deleteThread: vi.fn(),
    getThreads: vi.fn(),
    insertMessage: vi.fn(),
    replaceMessageHistory: vi.fn(),
    insertThread: vi.fn(),
    updateThreadTitle: vi.fn(),
    getBook: vi.fn(),
    getSkills: vi.fn(),
  },
  stream: vi.fn(),
  compress: vi.fn(),
}));
vi.mock("../db/database", () => boundaries.db);
vi.mock("../ai/agents/reading-agent", () => ({ streamReadingAgent: boundaries.stream }));
vi.mock("../ai/chat-memory", () => ({ maybeCompressThreadMemory: boundaries.compress }));

import { getChatStreamingKey, useChatStore } from "../stores/chat-store";
import { useStreamingChat } from "./use-streaming-chat";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mount(bookId?: string) {
  let chat!: ReturnType<typeof useStreamingChat>;
  function Host() {
    chat = useStreamingChat({ bookId });
    return null;
  }
  renderToString(createElement(Host));
  return chat;
}

const config: AIConfig = {
  endpoints: [],
  activeEndpointId: "",
  activeModel: "test",
  temperature: 0.7,
  maxTokens: 1024,
  slidingWindowSize: 8,
};

// 使用真实 hook、StreamingChat 与 Zustand store；只控制数据库及模型网络。
describe("发送接受确认", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useChatStore.setState(useChatStore.getInitialState(), true);
    boundaries.db.getSkills.mockResolvedValue([]);
    boundaries.compress.mockImplementation(async (thread) => thread);
    boundaries.stream.mockImplementation(async function* () {
      yield { type: "token", content: "answer" };
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("用户消息可见且流状态建立后确认一次，Promise 仍等待回答结束", async () => {
    const write = deferred();
    const network = deferred();
    const requested = deferred();
    boundaries.db.insertMessage.mockReturnValueOnce(write.promise);
    boundaries.stream.mockImplementation(async function* () {
      requested.resolve();
      await network.promise;
      yield { type: "token", content: "answer" };
    });
    const chat = mount("book-1");
    const accepted = vi.fn(() => {
      const state = useChatStore.getState();
      expect(state.threads[0].messages[0]).toMatchObject({ role: "user", content: "question" });
      expect(state.streamingSessions[getChatStreamingKey("book-1")].isStreaming).toBe(true);
      expect(boundaries.stream).not.toHaveBeenCalled();
    });
    let finished = false;
    const sending = chat
      .sendMessage("question", undefined, false, false, undefined, config, accepted)
      .then(() => {
        finished = true;
      });
    await vi.waitFor(() => expect(boundaries.db.insertMessage).toHaveBeenCalledOnce());
    expect(accepted).not.toHaveBeenCalled();
    write.resolve();
    await requested.promise;
    expect(accepted).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledWith(useChatStore.getState().threads[0].id);
    expect(finished).toBe(false);
    network.resolve();
    await sending;
    await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
    expect(accepted).toHaveBeenCalledOnce();
    expect(finished).toBe(true);
  });

  it("空输入或同一会话已有流时不确认、不新增消息", async () => {
    const chat = mount();
    const accepted = vi.fn();
    await chat.sendMessage("  ", undefined, false, false, [], config, accepted);
    expect(accepted).not.toHaveBeenCalled();
    expect(useChatStore.getState().threads).toEqual([]);
    useChatStore.getState().startStreamingSession({
      key: getChatStreamingKey(),
      threadId: "existing",
      isStreaming: true,
      currentMessage: null,
      currentStep: "thinking",
      startedAt: 1,
      updatedAt: 1,
    });
    await chat.sendMessage("question", undefined, false, false, undefined, config, accepted);
    expect(accepted).not.toHaveBeenCalled();
    expect(boundaries.db.insertMessage).not.toHaveBeenCalled();
    expect(boundaries.stream).not.toHaveBeenCalled();
  });

  it("慢时钟下修订问题及后续消息的时间仍保持对话顺序", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    useChatStore.setState({
      generalActiveThreadId: "thread",
      threads: [
        {
          id: "thread",
          title: "test",
          createdAt: 1,
          updatedAt: 1,
          messages: [
            {
              id: "before",
              threadId: "thread",
              role: "assistant",
              content: "before",
              createdAt: 5000,
            },
            { id: "old", threadId: "thread", role: "user", content: "old", createdAt: 6000 },
          ],
        },
      ],
    });
    boundaries.db.replaceMessageHistory.mockImplementationOnce(
      async (_threadId, _messageId, replacement) => ({
        messages: [
          useChatStore.getState().threads[0].messages[0],
          { ...replacement, createdAt: 5001 },
        ],
        updatedAt: 6001,
      }),
    );
    const chat = mount();
    await chat.sendMessage("edited", undefined, false, false, undefined, config, undefined, {
      threadId: "thread",
      messageId: "old",
    });
    let messages = useChatStore.getState().threads[0].messages;
    expect(messages.map((message) => message.createdAt)).toEqual([5000, 5001, 5002]);
    await chat.sendMessage("follow up", undefined, false, false, undefined, config);
    messages = useChatStore.getState().threads[0].messages;
    expect(messages.map((message) => message.createdAt)).toEqual([5000, 5001, 5002, 5003, 5004]);
  });

  it("只有引用也能被接受", async () => {
    const accepted = vi.fn();
    await mount().sendMessage(
      "",
      undefined,
      false,
      false,
      [{ id: "A", text: "quote A" }],
      config,
      accepted,
    );
    expect(accepted).toHaveBeenCalledOnce();
    expect(useChatStore.getState().threads[0].messages[0].content).toContain("quote A");
  });

  it("接受前状态更新异常时不确认", async () => {
    const chat = mount();
    const accepted = vi.fn();
    let failed = false;
    const unsubscribe = useChatStore.subscribe((state) => {
      if (state.threads.length && !failed) {
        failed = true;
        throw new Error("state update failed");
      }
    });
    try {
      await expect(
        chat.sendMessage("question", undefined, false, false, undefined, config, accepted),
      ).rejects.toThrow("state update failed");
    } finally {
      unsubscribe();
    }
    expect(accepted).not.toHaveBeenCalled();
    expect(boundaries.stream).not.toHaveBeenCalled();
  });

  it("用户消息保存失败时不确认、不更新历史并向输入框报告错误", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    boundaries.db.insertMessage.mockRejectedValueOnce(new Error("database unavailable"));
    const accepted = vi.fn();
    await expect(
      mount().sendMessage("question", undefined, false, false, undefined, config, accepted),
    ).rejects.toThrow("database unavailable");
    expect(accepted).not.toHaveBeenCalled();
    expect(useChatStore.getState().threads[0].messages).toEqual([]);
    expect(boundaries.stream).not.toHaveBeenCalled();
  });

  it("准备阶段停止后等待准备收尾，且不会启动模型", async () => {
    const preparing = deferred();
    boundaries.db.getSkills.mockReturnValueOnce(preparing.promise.then(() => []));
    const chat = mount();
    const accepted = vi.fn();
    const sending = chat.sendMessage("old", undefined, false, false, undefined, config, accepted);
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = chat.stopStream().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    preparing.resolve();
    await Promise.all([sending, stopping]);
    expect(boundaries.stream).not.toHaveBeenCalled();
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("停止等待旧回答落库，重发只使用替换后的历史并清空旧摘要", async () => {
    const requested = deferred();
    const release = deferred();
    const persisted = deferred();
    boundaries.stream.mockImplementationOnce(async function* () {
      requested.resolve();
      yield { type: "token", content: "old answer" };
      await release.promise;
      yield { type: "token", content: "late old answer" };
    });
    const chat = mount();
    const sending = chat.sendMessage("old question", undefined, false, false, undefined, config);
    await requested.promise;
    boundaries.db.insertMessage.mockImplementationOnce(() => persisted.promise);
    let stopped = false;
    const stopping = chat.stopStream().then(() => {
      stopped = true;
    });
    await vi.waitFor(() => expect(boundaries.db.insertMessage).toHaveBeenCalledTimes(2));
    expect(stopped).toBe(false);
    persisted.resolve();
    await Promise.all([sending, stopping]);
    const thread = useChatStore.getState().threads[0];
    expect(thread.messages).toHaveLength(2);
    useChatStore.setState({
      threads: [{ ...thread, memorySummary: "stale memory", memoryMessageCount: 2 }],
    });
    boundaries.db.replaceMessageHistory.mockImplementationOnce(
      async (_threadId, _messageId, replacement) => ({ messages: [replacement], updatedAt: 99 }),
    );
    const accepted = vi.fn();
    await chat.sendMessage(
      "corrected question",
      undefined,
      false,
      false,
      undefined,
      config,
      accepted,
      { threadId: thread.id, messageId: thread.messages[0].id },
    );
    expect(accepted).toHaveBeenCalledOnce();
    const compressedThread =
      boundaries.compress.mock.calls[boundaries.compress.mock.calls.length - 1][0];
    expect(
      compressedThread.messages.map((message: { content: string }) => message.content),
    ).toEqual(["corrected question"]);
    expect(compressedThread.memorySummary).toBeUndefined();
    expect(compressedThread.memoryMessageCount).toBe(0);
    release.resolve();
    await Promise.resolve();
    expect(useChatStore.getState().threads[0].messages.map((message) => message.content)).toEqual([
      "corrected question",
      "answer",
    ]);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("修订事务失败保留完整历史，不确认也不调用模型", async () => {
    await mount().sendMessage("original", undefined, false, false, undefined, config);
    const thread = useChatStore.getState().threads[0];
    boundaries.stream.mockClear();
    boundaries.db.replaceMessageHistory.mockRejectedValueOnce(new Error("disk full"));
    const accepted = vi.fn();
    await expect(
      mount().sendMessage("edited", undefined, false, false, undefined, config, accepted, {
        threadId: thread.id,
        messageId: thread.messages[0].id,
      }),
    ).rejects.toThrow("disk full");
    expect(useChatStore.getState().threads[0]).toEqual(thread);
    expect(accepted).not.toHaveBeenCalled();
    expect(boundaries.stream).not.toHaveBeenCalled();
  });

  it("切换会话后旧编辑提交不能替换历史", async () => {
    await mount().sendMessage("original", undefined, false, false, undefined, config);
    const thread = useChatStore.getState().threads[0];
    const accepted = vi.fn();
    await expect(
      mount().sendMessage("edited", undefined, false, false, undefined, config, accepted, {
        threadId: thread.id,
        messageId: thread.messages[0].id,
        isCurrent: () => false,
      }),
    ).rejects.toThrow("Conversation changed before sending");
    expect(boundaries.db.replaceMessageHistory).not.toHaveBeenCalled();
    expect(useChatStore.getState().threads[0]).toEqual(thread);
    expect(accepted).not.toHaveBeenCalled();
  });

  it.each(["error", "stop"])("接受后 %s 不重复确认，用户消息仍在", async (outcome) => {
    const requested = deferred();
    const release = deferred();
    boundaries.stream.mockImplementation(async function* () {
      requested.resolve();
      await release.promise;
      yield { type: "error", error: "network unavailable" };
    });
    const chat = mount();
    const accepted = vi.fn();
    const sending = chat.sendMessage(
      "question",
      undefined,
      false,
      false,
      undefined,
      config,
      accepted,
    );
    await requested.promise;
    expect(accepted).toHaveBeenCalledOnce();
    if (outcome === "stop") chat.stopStream();
    else release.resolve();
    await sending;
    release.resolve();
    await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
    expect(accepted).toHaveBeenCalledOnce();
    expect(useChatStore.getState().threads[0].messages[0]).toMatchObject({
      role: "user",
      content: "question",
    });
  });
});
