import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { Book } from "@readany/core/types";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fallbackContentService,
  setFallbackContentProvider,
} from "../../../../core/src/ai/fallback-content-service";
import * as extractionService from "../../lib/rag/extraction-service";
import { type ExtractionRequest, ExtractionRequestQueue } from "./extraction-request-queue";

interface ExtractorHandle {
  extractChapters(data: string, mimeType?: string): Promise<unknown>;
}
interface ViewProps {
  ref: { current: { injectJavaScript(script: string): void } | null };
  onMessage(event: { nativeEvent: { data: string } }): void;
  onLoadStart(): void;
  onError(event: { nativeEvent: { description: string } }): void;
  onHttpError(event: { nativeEvent: { description: string; statusCode: number } }): void;
  onContentProcessDidTerminate(): void;
  onRenderProcessGone(event: { nativeEvent: { didCrash: boolean } }): void;
}
interface Element {
  type: string;
  key?: number;
  props: ViewProps & { children?: Element };
}

// 只替换原生环境和 Hook 调度，组件源码与请求队列保持真实实现。
const source = transformSync(
  readFileSync(new URL("./ExtractorWebView.tsx", import.meta.url), "utf8"),
  { loader: "tsx", format: "cjs", jsx: "automatic" },
).code;

function setup() {
  const slots = new Map<number, unknown>();
  const effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  let cursor = 0;
  const ref: { current: ExtractorHandle | null } = { current: null };
  const inject = vi.fn<(script: string) => void>();
  const hooks = {
    forwardRef: (component: unknown) => component,
    useRef<T>(initial: T) {
      const slot = cursor++;
      if (!slots.has(slot)) slots.set(slot, { current: initial });
      return slots.get(slot) as { current: T };
    },
    useState<T>(initial: T) {
      const slot = cursor++;
      if (!slots.has(slot)) slots.set(slot, initial);
      return [slots.get(slot), (value: T) => slots.set(slot, value)];
    },
    useCallback<T>(callback: T) {
      const slot = cursor++;
      if (!slots.has(slot)) slots.set(slot, callback);
      return slots.get(slot) as T;
    },
    useEffect(effect: () => undefined | (() => void)) {
      const slot = cursor++;
      if (slots.has(slot)) return;
      slots.set(slot, true);
      effects.push(() => {
        const cleanup = effect();
        if (cleanup) cleanups.push(cleanup);
      });
    },
    useImperativeHandle(handleRef: typeof ref, create: () => ExtractorHandle) {
      const slot = cursor++;
      if (slots.has(slot)) return;
      slots.set(slot, true);
      handleRef.current = create();
      cleanups.push(() => {
        handleRef.current = null;
      });
    },
  };
  const jsx = (type: string, props: Element["props"], key?: number) => ({ type, props, key });
  const modules: Record<string, unknown> = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { StyleSheet: { absoluteFill: {} }, View: "View" },
    "react-native-webview": { WebView: "WebView" },
    "expo-asset": {
      Asset: { fromModule: () => ({ downloadAsync: async () => ({ localUri: "reader.html" }) }) },
    },
    "../../../assets/reader/reader.html": "reader-asset",
    "./extraction-request-queue": { ExtractionRequestQueue },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected test import: ${name}`);
      return modules[name];
    },
    module,
    module.exports,
  );
  const { ExtractorWebView } = module.exports as {
    ExtractorWebView: (
      props: object,
      handleRef: { current: ExtractorHandle | null },
    ) => Element | null;
  };
  function render() {
    cursor = 0;
    const tree = ExtractorWebView({}, ref);
    const view = tree?.props.children ?? null;
    if (view) view.props.ref.current = { injectJavaScript: inject };
    for (const effect of effects.splice(0)) effect();
    return view;
  }
  function renderView() {
    const view = render();
    if (!view || typeof view.key !== "number") throw new Error("Extractor WebView was not mounted");
    return { ...view, key: view.key };
  }
  function unmount() {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  }
  const message = (view: Element, data: object) =>
    view.props.onMessage({ nativeEvent: { data: JSON.stringify(data) } });
  const request = (index: number): ExtractionRequest => {
    let sent: ExtractionRequest | undefined;
    new Function("window", inject.mock.calls[index][0])({
      postMessage: (data: string) => {
        sent = JSON.parse(data);
      },
    });
    if (!sent) throw new Error("No extraction request was injected");
    return sent;
  };
  const mount = async () => {
    render();
    await Promise.resolve();
    const view = renderView();
    view.props.onLoadStart();
    return view;
  };
  return {
    inject,
    renderView,
    unmount,
    message,
    mount,
    request,
    get extractor() {
      if (!ref.current) throw new Error("Extractor handle is not mounted");
      return ref.current;
    },
  };
}

let host: ReturnType<typeof setup>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = setup();
});
afterEach(() => {
  host.unmount();
  extractionService.setChapterExtractor(null);
  setFallbackContentProvider(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ExtractorHost 注册生命周期", () => {
  it("挂载时连接提取和 fallback，卸载时注销两者", async () => {
    const extract = vi.fn().mockResolvedValue([]);
    const effects: (() => () => void)[] = [];
    const readFile = vi.fn().mockResolvedValue(new Uint8Array([65]));
    const book: Book = {
      id: "host-book",
      filePath: "book.epub",
      format: "epub",
      meta: { title: "测试书籍", author: "作者" },
      addedAt: 0,
      updatedAt: 0,
      progress: 0,
      isVectorized: false,
      vectorizeProgress: 0,
      tags: [],
      syncStatus: "local",
    };
    const jsx = (_type: unknown, props: { ref: { current: unknown } }) => {
      props.ref.current = { extractChapters: extract };
    };
    const modules: Record<string, unknown> = {
      react: {
        useRef: () => ({ current: null }),
        useEffect: (effect: () => () => void) => effects.push(effect),
      },
      "react/jsx-runtime": { jsx },
      "@/lib/rag/extraction-service": extractionService,
      "@/lib/rag/auto-vectorize-book": { resolveMobileBookPath: async (path: string) => path },
      "@readany/core/ai": { setFallbackContentProvider },
      "@readany/core/services": { getPlatformService: () => ({ readFile }) },
      "expo-file-system": {
        File: class {
          exists = true;
        },
      },
      "./ExtractorWebView": { ExtractorWebView: "ExtractorWebView" },
    };
    const hostSource = transformSync(
      readFileSync(new URL("./ExtractorHost.tsx", import.meta.url), "utf8"),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code;
    const module = { exports: {} };
    new Function("require", "module", "exports", hostSource)(
      (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected test import: ${name}`);
        return modules[name];
      },
      module,
      module.exports,
    );
    (module.exports as { ExtractorHost(): void }).ExtractorHost();
    const cleanup = effects[0]();
    await expect(extractionService.extractChapters("manual")).resolves.toEqual([]);
    await expect(fallbackContentService.getChapters(book)).resolves.toEqual([]);
    expect(readFile).toHaveBeenCalledWith("book.epub");
    expect(extract).toHaveBeenNthCalledWith(1, "manual", undefined);
    expect(extract).toHaveBeenNthCalledWith(2, "QQ==", "application/epub+zip");
    cleanup();
    await expect(extractionService.extractChapters("after-unmount")).rejects.toThrow("not ready");
    await expect(fallbackContentService.getChapters(book)).rejects.toThrow(
      "provider is not registered",
    );
    expect(extract).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ExtractorWebView 页面恢复", () => {
  it.each([
    ["iOS", (view: Element) => view.props.onContentProcessDidTerminate()],
    [
      "Android",
      (view: Element) => view.props.onRenderProcessGone({ nativeEvent: { didCrash: true } }),
    ],
  ])("%s 空闲进程终止后重建，新页面就绪后可提取", async (_platform, terminate) => {
    const view = await host.mount();
    host.message(view, { type: "ready" });
    terminate(view);
    const recovered = host.renderView();
    expect(recovered.key).not.toBe(view.key);
    recovered.props.onLoadStart();
    host.message(recovered, { type: "ready" });
    const result = host.extractor.extractChapters("book");
    expect(host.inject).toHaveBeenCalledOnce();
    host.message(recovered, {
      type: "chaptersExtracted",
      requestId: host.request(0).requestId,
      chapters: [],
    });
    await expect(result).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("同步作废旧代，重渲染前后的重复故障和伪造新请求响应都无效", async () => {
    const oldView = await host.mount();
    host.message(oldView, { type: "ready" });
    oldView.props.onContentProcessDidTerminate();
    oldView.props.onContentProcessDidTerminate();
    oldView.props.onLoadStart();
    host.message(oldView, { type: "ready" });
    await expect(host.extractor.extractChapters("too-early")).rejects.toThrow("not ready");

    const view = host.renderView();
    expect(view.key).toBe(oldView.key + 1);
    view.props.onLoadStart();
    host.message(view, { type: "ready" });
    const result = host.extractor.extractChapters("new-book");
    const onResult = vi.fn();
    void result.then(onResult);
    const request = host.request(0);
    oldView.props.onRenderProcessGone({ nativeEvent: { didCrash: false } });
    host.message(oldView, { type: "ready" });
    host.message(oldView, {
      type: "chaptersExtracted",
      requestId: request.requestId,
      chapters: [],
    });
    await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
    expect(host.renderView()?.key).toBe(view.key);
    host.message(view, { type: "chaptersExtracted", requestId: request.requestId, chapters: [] });
    await expect(result).resolves.toEqual([]);
  });

  it("执行中进程终止时结算全部请求，重建后不重放旧书", async () => {
    const view = await host.mount();
    host.message(view, { type: "ready" });
    const activeError = vi.fn();
    const queuedError = vi.fn();
    const a = host.extractor.extractChapters("A").catch(activeError);
    const b = host.extractor.extractChapters("B").catch(queuedError);
    view.props.onRenderProcessGone({ nativeEvent: { didCrash: true } });
    view.props.onContentProcessDidTerminate();
    await Promise.all([a, b]);
    expect(activeError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining("render process gone") }),
    );
    expect(queuedError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining("render process gone") }),
    );
    expect(vi.getTimerCount()).toBe(0);

    const recovered = host.renderView();
    recovered.props.onLoadStart();
    host.message(recovered, { type: "ready" });
    const next = host.extractor.extractChapters("C");
    expect([host.request(0).base64, host.request(1).base64]).toEqual(["A", "C"]);
    host.message(recovered, {
      type: "chaptersExtracted",
      requestId: host.request(1).requestId,
      chapters: [],
    });
    await expect(next).resolves.toEqual([]);
    expect(host.inject).toHaveBeenCalledTimes(2);
  });

  it.each(["timeout", "injection"])("%s 失效通知通过同一入口重建页面", async (failure) => {
    const view = await host.mount();
    host.message(view, { type: "ready" });
    if (failure === "injection")
      host.inject.mockImplementationOnce(() => {
        throw new Error("native ref lost");
      });
    const result = host.extractor.extractChapters("A").catch((error: Error) => error.message);
    const queued = host.extractor.extractChapters("B").catch((error: Error) => error.message);
    if (failure === "timeout") vi.advanceTimersByTime(45_000);
    expect(await result).toBe(
      failure === "timeout" ? "Timed out extracting book content" : "native ref lost",
    );
    expect(await queued).toBe(
      failure === "timeout" ? "Extractor WebView reset" : "Extractor WebView not ready",
    );
    expect(vi.getTimerCount()).toBe(0);
    const recovered = host.renderView();
    expect(recovered.key).toBe(view.key + 1);
    recovered.props.onLoadStart();
    host.message(recovered, { type: "ready" });
    const next = host.extractor.extractChapters("C");
    host.message(recovered, {
      type: "chaptersExtracted",
      requestId: host.request(1).requestId,
      chapters: [],
    });
    await expect(next).resolves.toEqual([]);
  });

  it.each([false, true])(
    "加载连续失败时停止自动重建，仅新调用触发重试（曾就绪：%s）",
    async (wasReady) => {
      let view = await host.mount();
      if (wasReady) {
        host.message(view, { type: "ready" });
        view.props.onContentProcessDidTerminate();
        view = host.renderView();
        view.props.onLoadStart();
      }
      const generation = view.key;
      view.props.onError({ nativeEvent: { description: "load failed" } });
      view.props.onHttpError({ nativeEvent: { description: "unavailable", statusCode: 503 } });
      view.props.onContentProcessDidTerminate();
      view.props.onLoadStart();
      host.message(view, { type: "ready" });
      expect(host.renderView()?.key).toBe(generation);
      expect(host.inject).not.toHaveBeenCalled();

      await expect(host.extractor.extractChapters("retry")).rejects.toThrow("not ready");
      await expect(host.extractor.extractChapters("still-loading")).rejects.toThrow("not ready");
      const retried = host.renderView();
      expect(retried.key).toBe(generation + 1);
      retried.props.onLoadStart();
      expect(host.renderView()?.key).toBe(retried.key);
      host.message(retried, { type: "ready" });
      const result = host.extractor.extractChapters("new-book");
      host.message(retried, {
        type: "chaptersExtracted",
        requestId: host.request(0).requestId,
        chapters: [],
      });
      await expect(result).resolves.toEqual([]);
    },
  );

  it("已就绪页面加载错误也重建一次", async () => {
    const view = await host.mount();
    host.message(view, { type: "ready" });
    view.props.onHttpError({ nativeEvent: { statusCode: 503, description: "unavailable" } });
    expect(host.renderView()?.key).toBe(view.key + 1);
  });

  it("onLoadStart 只清理当前请求，同代加载完成后可继续使用", async () => {
    const view = await host.mount();
    host.message(view, { type: "ready" });
    const active = host.extractor.extractChapters("A").catch((error: Error) => error.message);
    view.props.onLoadStart();
    expect(await active).toBe("Extractor WebView reloaded");
    expect(host.renderView()?.key).toBe(view.key);
    host.message(view, { type: "ready" });
    const next = host.extractor.extractChapters("B");
    host.message(view, {
      type: "chaptersExtracted",
      requestId: host.request(1).requestId,
      chapters: [],
    });
    await expect(next).resolves.toEqual([]);
  });

  it("卸载后结算全部请求，旧回调和保留的句柄不能重新激活", async () => {
    const view = await host.mount();
    host.message(view, { type: "ready" });
    const handle = host.extractor;
    const a = handle.extractChapters("A").catch((error: Error) => error.message);
    const b = handle.extractChapters("B").catch((error: Error) => error.message);
    host.unmount();
    await expect(Promise.all([a, b])).resolves.toEqual([
      "Extractor WebView unmounted",
      "Extractor WebView unmounted",
    ]);
    view.props.onContentProcessDidTerminate();
    view.props.onLoadStart();
    host.message(view, { type: "ready" });
    host.message(view, {
      type: "chaptersExtracted",
      requestId: host.request(0).requestId,
      chapters: [],
    });
    await expect(handle.extractChapters("C")).rejects.toThrow("Extractor WebView unmounted");
    expect(host.inject).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
