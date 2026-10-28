import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig } from "../types";

const boundaries = vi.hoisted(() => ({
  db: {
    deleteThread: vi.fn(),
    getThreads: vi.fn(),
    insertMessage: vi.fn(),
    insertThread: vi.fn(),
    updateThreadTitle: vi.fn(),
    getBook: vi.fn(),
    getSkills: vi.fn(),
  },
  stream: vi.fn(),
}));
vi.mock("../db/database", () => boundaries.db);
vi.mock("../ai/agents/reading-agent", () => ({ streamReadingAgent: boundaries.stream }));

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
      await chat.sendMessage("question", undefined, false, false, undefined, config, accepted);
    } finally {
      unsubscribe();
    }
    expect(accepted).not.toHaveBeenCalled();
    expect(boundaries.stream).not.toHaveBeenCalled();
  });

  it("数据库写入失败但内存已接受时仍确认", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    boundaries.db.insertMessage.mockRejectedValueOnce(new Error("database unavailable"));
    const accepted = vi.fn();
    await mount().sendMessage("question", undefined, false, false, undefined, config, accepted);
    expect(accepted).toHaveBeenCalledOnce();
    expect(useChatStore.getState().threads[0].messages[0].content).toBe("question");
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
