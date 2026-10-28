import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, Message, Thread } from "../../types";

const boundaries = vi.hoisted(() => ({
  createModel: vi.fn(),
  invoke: vi.fn(),
  updateMemory: vi.fn(),
}));
vi.mock("../llm-provider", () => ({ createChatModel: boundaries.createModel }));
vi.mock("../../db/database", () => ({ updateThreadMemory: boundaries.updateMemory }));

import { getCompressibleMessages, maybeCompressThreadMemory } from "../chat-memory";

function message(id: number): Message {
  return {
    id: `msg-${id}`,
    threadId: "thread-1",
    role: id % 2 === 0 ? "assistant" : "user",
    content: `message ${id}`,
    createdAt: id,
  };
}

function thread(messages: Message[], memoryMessageCount = 0): Thread {
  return {
    id: "thread-1",
    title: "Thread",
    messages,
    memoryMessageCount,
    createdAt: 1,
    updatedAt: 1,
  };
}

const config: AIConfig = {
  endpoints: [],
  activeEndpointId: "",
  activeModel: "test",
  temperature: 0.7,
  maxTokens: 1024,
  slidingWindowSize: 4,
};

beforeEach(() => {
  vi.resetAllMocks();
  boundaries.createModel.mockResolvedValue({ invoke: boundaries.invoke });
  boundaries.invoke.mockResolvedValue({ content: "summary" });
});

describe("chat memory compression window", () => {
  it("returns only messages outside the sliding window", () => {
    const messages = Array.from({ length: 10 }, (_, index) => message(index + 1));

    const compressible = getCompressibleMessages(thread(messages), 4);

    expect(compressible.map((item) => item.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
      "msg-5",
      "msg-6",
    ]);
  });

  it("does not return messages that were already summarized", () => {
    const messages = Array.from({ length: 10 }, (_, index) => message(index + 1));

    const compressible = getCompressibleMessages(thread(messages, 4), 4);

    expect(compressible.map((item) => item.id)).toEqual(["msg-5", "msg-6"]);
  });
});

describe("摘要取消与保存", () => {
  const history = () => thread(Array.from({ length: 10 }, (_, index) => message(index + 1)));

  it("传递取消信号并在正常完成后保存摘要", async () => {
    const controller = new AbortController();
    const result = await maybeCompressThreadMemory(history(), config, controller.signal);
    expect(boundaries.invoke.mock.calls[0][1]).toEqual({ signal: controller.signal });
    expect(boundaries.updateMemory).toHaveBeenCalledWith("thread-1", "summary", 6);
    expect(result.memorySummary).toBe("summary");
  });

  it("已取消时不创建模型", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = history();
    expect(await maybeCompressThreadMemory(source, config, controller.signal)).toBe(source);
    expect(boundaries.createModel).not.toHaveBeenCalled();
    expect(boundaries.updateMemory).not.toHaveBeenCalled();
  });

  it("模型创建期间取消，不启动摘要请求", async () => {
    const controller = new AbortController();
    boundaries.createModel.mockImplementationOnce(async () => {
      controller.abort();
      return { invoke: boundaries.invoke };
    });
    await maybeCompressThreadMemory(history(), config, controller.signal);
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(boundaries.updateMemory).not.toHaveBeenCalled();
  });

  it("摘要返回前取消，即使模型返回成功也不写入旧摘要", async () => {
    const controller = new AbortController();
    let resolve!: (value: { content: string }) => void;
    boundaries.invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const source = history();
    const pending = maybeCompressThreadMemory(source, config, controller.signal);
    await vi.waitFor(() => expect(boundaries.invoke).toHaveBeenCalledOnce());
    controller.abort();
    resolve({ content: "late summary" });
    expect(await pending).toBe(source);
    expect(boundaries.updateMemory).not.toHaveBeenCalled();
  });

  it("已开始写入的摘要仍等待持久化收尾", async () => {
    let resolve!: () => void;
    boundaries.updateMemory.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    let finished = false;
    const pending = maybeCompressThreadMemory(history(), config, controller.signal).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(boundaries.updateMemory).toHaveBeenCalledOnce());
    controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    resolve();
    await pending;
  });
});
