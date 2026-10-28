import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig } from "../types";

const boundaries = vi.hoisted(() => ({
  db: {
    getSkills: vi.fn(),
    insertMessage: vi.fn(),
    updateThreadMemory: vi.fn(),
  },
  invoke: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("../db/database", () => boundaries.db);
vi.mock("../ai/llm-provider", () => ({
  createChatModel: async () => ({ invoke: boundaries.invoke }),
}));
vi.mock("../ai/agents/reading-agent", () => ({ streamReadingAgent: boundaries.stream }));

import { useChatStore } from "../stores/chat-store";
import { useStreamingChat } from "./use-streaming-chat";

const config: AIConfig = {
  endpoints: [],
  activeEndpointId: "",
  activeModel: "test",
  temperature: 0.7,
  maxTokens: 1024,
  slidingWindowSize: 4,
};

function mount() {
  let chat!: ReturnType<typeof useStreamingChat>;
  function Host() {
    chat = useStreamingChat();
    return null;
  }
  renderToString(createElement(Host));
  return chat;
}

// 真实 hook、摘要函数与流服务，仅隔离数据库和模型网络。
describe("准备阶段的摘要取消", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useChatStore.setState(useChatStore.getInitialState(), true);
    useChatStore.setState({
      generalActiveThreadId: "thread",
      threads: [
        {
          id: "thread",
          title: "history",
          createdAt: 1,
          updatedAt: 1,
          messages: Array.from({ length: 10 }, (_, index) => ({
            id: `old-${index}`,
            threadId: "thread",
            role: index % 2 ? ("assistant" as const) : ("user" as const),
            content: `message ${index}`,
            createdAt: index + 1,
          })),
        },
      ],
    });
    boundaries.db.getSkills.mockResolvedValue([]);
  });

  it("停止中断尚未返回的摘要请求，立即允许再次发送", async () => {
    boundaries.invoke.mockImplementationOnce(
      (_messages, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const chat = mount();
    const pending = chat.sendMessage("question", undefined, false, false, undefined, config);
    await vi.waitFor(() => expect(boundaries.invoke).toHaveBeenCalledOnce());
    const signal = boundaries.invoke.mock.calls[0][1].signal as AbortSignal;
    await chat.stopStream();
    await pending;
    expect(signal.aborted).toBe(true);
    expect(boundaries.db.updateThreadMemory).not.toHaveBeenCalled();
    expect(boundaries.stream).not.toHaveBeenCalled();
    expect(useChatStore.getState().isStreaming).toBe(false);

    boundaries.invoke.mockResolvedValueOnce({ content: "fresh summary" });
    boundaries.stream.mockImplementationOnce(async function* ({ signal: streamSignal }) {
      expect(streamSignal.aborted).toBe(false);
      yield { type: "token", content: "new answer" };
    });
    await chat.sendMessage("corrected", undefined, false, false, undefined, config);
    expect(boundaries.stream).toHaveBeenCalledOnce();
    const messages = useChatStore.getState().threads[0].messages;
    expect(messages[messages.length - 1]?.content).toBe("new answer");
  });

  it("摘要与回答使用同一个取消信号", async () => {
    boundaries.invoke.mockResolvedValueOnce({ content: "summary" });
    boundaries.stream.mockImplementationOnce(async function* ({ signal }) {
      expect(signal).toBe(boundaries.invoke.mock.calls[0][1].signal);
      yield { type: "token", content: "answer" };
    });
    await mount().sendMessage("question", undefined, false, false, undefined, config);
    expect(boundaries.db.updateThreadMemory).toHaveBeenCalledOnce();
    expect(boundaries.stream).toHaveBeenCalledOnce();
  });
});
