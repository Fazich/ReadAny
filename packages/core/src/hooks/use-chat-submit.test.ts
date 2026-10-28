import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, AttachedQuote } from "../types/chat";
import type { MessageV2 } from "../types/message";

// 执行真实共享 hook；只替换 React 渲染宿主，不复制编辑或提交逻辑。
const react = vi.hoisted(() => {
  let slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (next: unknown) => {
          slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      slots[index] ??= { value: { current: initial } };
      return slots[index].value;
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect: () => undefined | (() => void), deps: unknown[]) {
      const index = cursor++;
      if (slots[index] && same(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[index].cleanup = effect() || undefined;
      });
    },
  };
  return {
    hooks,
    render<T>(callback: () => T): T {
      cursor = 0;
      effects = [];
      const result = callback();
      for (const effect of effects) effect();
      return result;
    },
    reset() {
      for (const slot of slots) slot.cleanup?.();
      slots = [];
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
    },
  };
});
vi.mock("react", () => react.hooks);

import { useChatSubmit } from "./use-chat-submit";

const config: AIConfig = {
  endpoints: [],
  activeEndpointId: "endpoint",
  activeModel: "model",
  temperature: 0.7,
  maxTokens: 1024,
  slidingWindowSize: 8,
};
const quote: AttachedQuote = { id: "draft-quote", text: "未发送引用" };
const message: MessageV2 = {
  id: "historical-user",
  threadId: "thread",
  role: "user",
  createdAt: 1,
  parts: [
    {
      id: "q",
      type: "quote",
      text: "完整引用".repeat(200),
      source: "第一章",
      status: "completed",
      createdAt: 1,
    },
    { id: "t", type: "text", text: "正文", status: "completed", createdAt: 1 },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  react.reset();
  let quotes = [quote];
  const options = {
    threadId: "thread" as string | null,
    bookId: "book" as string | undefined,
    quotes,
    setQuotes: (next: AttachedQuote[] | ((current: AttachedQuote[]) => AttachedQuote[])) => {
      quotes = typeof next === "function" ? next(quotes) : next;
    },
    sendMessage: vi.fn<Parameters<typeof useChatSubmit>[0]["sendMessage"]>(async () => {}),
    stopStream: vi.fn<() => void | Promise<void>>(),
    resolveConfig: vi.fn<Parameters<typeof useChatSubmit>[0]["resolveConfig"]>(() => config),
    onConfigRequired: vi.fn(),
    onError: vi.fn(),
  };
  const render = () => react.render(() => useChatSubmit({ ...options, quotes }));
  return {
    options,
    render,
    get quotes() {
      return quotes;
    },
  };
}

afterEach(() => react.reset());

describe("共享编辑与提交", () => {
  it("任意历史用户消息可切换，取消恢复最初引用，拒绝其他线程和非用户消息", () => {
    const host = setup();
    host.render().edit.startEdit(message);
    expect(host.quotes[0].text).toBe("完整引用".repeat(200));
    host.render().edit.startEdit({ ...message, id: "older-user" });
    expect(host.render().edit.editMessage?.id).toBe("older-user");
    host.render().edit.startEdit({ ...message, role: "assistant" });
    host.render().edit.startEdit({ ...message, threadId: "other" });
    expect(host.render().edit.editMessage?.id).toBe("older-user");
    host.render().edit.cancelEdit();
    expect(host.render().edit.editMessage).toBeNull();
    expect(host.quotes).toEqual([quote]);
  });

  it("编辑等待停止落库后才发送，接受前失败保留编辑，接受只消费发送快照一次", async () => {
    const host = setup();
    host.render().edit.startEdit(message);
    const stopped = deferred<void>();
    host.options.stopStream.mockReturnValue(stopped.promise);
    const accepted = vi.fn();
    const sending = host.render().handleSend("修订正文", true, true, host.quotes, accepted);
    await Promise.resolve();
    expect(host.options.sendMessage).not.toHaveBeenCalled();
    host.options.sendMessage.mockRejectedValueOnce(new Error("save failed"));
    stopped.resolve();
    await sending;
    expect(host.options.onError).toHaveBeenCalledWith(new Error("save failed"));
    expect(host.render().edit.editMessage?.id).toBe(message.id);
    expect(accepted).not.toHaveBeenCalled();
    const sent = [...host.quotes];
    const added = { id: "new", text: "等待时新增" };
    host.options.sendMessage.mockImplementationOnce(async (...args) => {
      host.options.setQuotes((current) => [...current, added]);
      args[6]?.("thread");
      args[6]?.("thread");
    });
    await host.render().handleSend("修订正文", true, true, sent, accepted);
    expect(host.options.sendMessage.mock.lastCall).toEqual([
      "修订正文",
      "book",
      true,
      true,
      sent,
      config,
      expect.any(Function),
      { threadId: "thread", messageId: message.id, isCurrent: expect.any(Function) },
    ]);
    expect(accepted).toHaveBeenCalledOnce();
    expect(host.quotes).toEqual([added]);
    expect(host.render().edit.editMessage).toBeNull();
  });

  it.each(["配置缺失", "配置异常", "停止异常", "发送拒绝"])(
    "%s 不消费正文确认或引用",
    async (outcome) => {
      const host = setup();
      if (outcome === "配置缺失") host.options.resolveConfig.mockReturnValueOnce(null);
      if (outcome === "配置异常")
        host.options.resolveConfig.mockRejectedValueOnce(new Error("config"));
      if (outcome === "停止异常") {
        host.render().edit.startEdit(message);
        host.options.stopStream.mockRejectedValueOnce(new Error("stop"));
      }
      const before = host.quotes;
      const accepted = vi.fn();
      await host.render().handleSend("正文", false, false, before, accepted);
      expect(host.quotes).toEqual(before);
      expect(accepted).not.toHaveBeenCalled();
      expect(host.options.onConfigRequired).toHaveBeenCalledTimes(outcome === "配置缺失" ? 1 : 0);
      expect(host.options.onError).toHaveBeenCalledTimes(
        outcome === "配置异常" || outcome === "停止异常" ? 1 : 0,
      );
    },
  );

  it.each(["取消", "换目标", "换会话", "换书籍", "卸载", "切走再切回"])(
    "停止等待时%s使旧提交失效",
    async (action) => {
      const host = setup();
      host.render().edit.startEdit(message);
      const stopped = deferred<void>();
      host.options.stopStream.mockReturnValue(stopped.promise);
      const sending = host.render().handleSend("旧提交", false, false, host.quotes);
      await Promise.resolve();
      if (action === "取消") host.render().edit.cancelEdit();
      if (action === "换目标") host.render().edit.startEdit({ ...message, id: "other-user" });
      if (action === "换会话" || action === "切走再切回") host.options.threadId = "other";
      if (action === "换书籍") host.options.bookId = "other-book";
      host.render();
      if (action === "切走再切回") {
        host.options.threadId = "thread";
        host.render();
      }
      if (action === "卸载") react.unmount();
      stopped.resolve();
      await sending;
      expect(host.options.sendMessage).not.toHaveBeenCalled();
      expect(host.options.onError).not.toHaveBeenCalled();
    },
  );

  it.each(["新建线程", "其他线程", "其他书籍", "切走再切回"])(
    "普通发送的接受回调核对上下文：%s",
    async (action) => {
      const host = setup();
      host.options.threadId = null;
      const accepted = vi.fn();
      host.options.sendMessage.mockImplementationOnce(async (...args) => {
        host.options.threadId = action === "其他线程" ? "other" : "created";
        if (action === "其他书籍") host.options.bookId = "other-book";
        if (action === "切走再切回") {
          host.options.threadId = "other";
          host.render();
          host.options.threadId = null;
          host.render();
          host.options.threadId = "created";
        }
        host.render();
        args[6]?.("created");
      });
      await host.render().handleSend("正文", false, false, host.quotes, accepted);
      expect(accepted).toHaveBeenCalledTimes(action === "新建线程" ? 1 : 0);
      expect(host.quotes).toEqual(action === "新建线程" ? [] : [quote]);
    },
  );

  it.each(["取消", "换目标", "卸载"])("%s后旧接受回调及异常不改变新的编辑引用", async (action) => {
    const host = setup();
    host.render().edit.startEdit(message);
    const network = deferred<void>();
    let oldAccepted: ((threadId: string) => void) | undefined;
    host.options.sendMessage.mockImplementationOnce(async (...args) => {
      oldAccepted = args[6];
      await network.promise;
      throw new Error("old failure");
    });
    const accepted = vi.fn();
    const sending = host.render().handleSend("旧正文", false, false, host.quotes, accepted);
    await Promise.resolve();
    await Promise.resolve();
    expect(oldAccepted).toBeTypeOf("function");
    if (action === "取消") host.render().edit.cancelEdit();
    if (action === "换目标") host.render().edit.startEdit({ ...message, id: "another-user" });
    if (action === "卸载") react.unmount();
    const before = host.quotes;
    oldAccepted?.("thread");
    network.resolve();
    await sending;
    expect(host.quotes).toEqual(before);
    expect(accepted).not.toHaveBeenCalled();
    expect(host.options.onError).not.toHaveBeenCalled();
  });

  it.each(["配置成功", "配置缺失", "配置异常"])(
    "普通发送配置等待时切走再切回隔离旧%s",
    async (outcome) => {
      const host = setup();
      const resolving = deferred<AIConfig | null>();
      host.options.resolveConfig.mockReturnValueOnce(
        resolving.promise.then((result) => {
          if (outcome === "配置异常") throw new Error("config failure");
          return result;
        }),
      );
      const sending = host.render().handleSend("正文", false, false, host.quotes);
      host.options.threadId = "other";
      host.render();
      host.options.threadId = "thread";
      host.render();
      resolving.resolve(outcome === "配置缺失" ? null : config);
      await sending;
      expect(host.options.sendMessage).not.toHaveBeenCalled();
      expect(host.options.onConfigRequired).not.toHaveBeenCalled();
      expect(host.options.onError).not.toHaveBeenCalled();
      expect(host.quotes).toEqual([quote]);
    },
  );

  it("切换会话后调用旧入口回调不提交", async () => {
    const host = setup();
    const oldSend = host.render().handleSend;
    host.options.threadId = "other";
    host.render();
    await oldSend("旧入口正文", false, false, host.quotes);
    expect(host.options.sendMessage).not.toHaveBeenCalled();
    expect(host.quotes).toEqual([quote]);
  });

  it("引用在配置等待前固定，只有引用的提交保留选项并等待流结束", async () => {
    const host = setup();
    const resolving = deferred<AIConfig>();
    const network = deferred<void>();
    host.options.resolveConfig.mockReturnValueOnce(resolving.promise);
    const accepted = vi.fn();
    host.options.sendMessage.mockImplementationOnce(async (...args) => {
      args[6]?.("thread");
      await network.promise;
    });
    const sent = [{ id: "draft-quote", text: "原引用" }];
    let finished = false;
    const sending = host
      .render()
      .handleSend("", true, true, sent, accepted)
      .then(() => {
        finished = true;
      });
    sent[0].text = "后改引用";
    sent.push({ id: "later", text: "新增引用" });
    resolving.resolve(config);
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
    expect(host.options.sendMessage.mock.lastCall?.slice(0, 5)).toEqual([
      "",
      "book",
      true,
      true,
      [{ id: "draft-quote", text: "原引用" }],
    ]);
    expect(finished).toBe(false);
    network.resolve();
    await sending;
    expect(finished).toBe(true);
  });
});
