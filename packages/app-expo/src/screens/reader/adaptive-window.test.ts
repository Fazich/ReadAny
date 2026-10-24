// 折叠屏/大屏窗口适配回归（步骤1插件 + 步骤2模板 + 步骤3 RN 边界）。
// 全部执行真实产物：插件跑真实 Manifest 变换与 Expo 完整 mod 链，
// 模板执行真实主脚本（隔离 DOM/rAF 桩），RN 边界读取真实源码后
// 运行其中的连续边界逻辑。不复制生产公式自证。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const appRoot = join(repositoryRoot, "packages/app-expo");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

// ───────────────────────── 插件：真实 Manifest 行为 ─────────────────────────

describe("withAndroidAdaptiveWindow plugin", () => {
  const pluginPath = join(appRoot, "plugins/withAndroidAdaptiveWindow.js");

  /** 最小真实 Manifest 样本：第三方 activity 排前，MainActivity 非首项。 */
  function minimalManifest() {
    return {
      manifest: {
        $: { package: "com.readany.app" },
        application: [
          {
            activity: [
              {
                $: {
                  "android:name": "com.third.SdkActivity",
                  "android:screenOrientation": "portrait",
                },
              },
              {
                $: {
                  "android:name": ".MainActivity",
                  "android:screenOrientation": "portrait",
                  "android:configChanges": "keyboard|keyboardHidden|orientation",
                  "android:maxAspectRatio": "2.4",
                } as Record<string, string>,
              },
            ],
          },
        ],
      },
    };
  }

  function mainActivityOf(manifest: ReturnType<typeof minimalManifest>) {
    const main = manifest.manifest.application[0].activity.find(
      (a) => a.$["android:name"] === ".MainActivity",
    );
    if (!main) throw new Error("test sample must contain .MainActivity");
    return main;
  }

  const requireFresh = () =>
    require(pluginPath) as {
      applyAdaptiveWindowToManifest: (m: unknown) => unknown;
    };

  it("flips MainActivity orientation to unspecified and enables resizeableActivity", () => {
    const manifest = minimalManifest();
    requireFresh().applyAdaptiveWindowToManifest(manifest);
    const main = mainActivityOf(manifest);
    expect(main.$["android:screenOrientation"]).toBe("unspecified");
    expect(main.$["android:resizeableActivity"]).toBe("true");
    // 第三方 activity 不被误改
    const third = manifest.manifest.application[0].activity[0];
    expect(third.$["android:screenOrientation"]).toBe("portrait");
    expect(third.$["android:resizeableActivity"]).toBeUndefined();
  });

  it("keeps configChanges and drops maxAspectRatio", () => {
    const manifest = minimalManifest();
    requireFresh().applyAdaptiveWindowToManifest(manifest);
    const changes = mainActivityOf(manifest).$["android:configChanges"] as string;
    for (const key of [
      "keyboard",
      "keyboardHidden",
      "orientation",
      "screenSize",
      "screenLayout",
      "smallestScreenSize",
      "uiMode",
      "density",
    ]) {
      expect(changes.split("|")).toContain(key);
    }
    expect(mainActivityOf(manifest).$["android:maxAspectRatio"]).toBeUndefined();
  });

  it("is idempotent when applied twice", () => {
    const manifest = minimalManifest();
    requireFresh().applyAdaptiveWindowToManifest(manifest);
    const once = JSON.stringify(mainActivityOf(manifest));
    requireFresh().applyAdaptiveWindowToManifest(manifest);
    expect(JSON.stringify(mainActivityOf(manifest))).toBe(once);
  });

  it("throws when MainActivity is missing", () => {
    const manifest = minimalManifest();
    manifest.manifest.application[0].activity = manifest.manifest.application[0].activity.filter(
      (a) => a.$["android:name"] !== ".MainActivity",
    );
    expect(() => requireFresh().applyAdaptiveWindowToManifest(manifest)).toThrow(
      /missing the required MainActivity/,
    );
  });

  // 完整 mod 链：真实 Expo prebuild 编译所有插件（含内置 Orientation 写
  // portrait 的顺序），introspect 模式不落盘原生工程。执行顺序保证本
  // 插件最终生效；iOS 方向由 app.config.js 的全局 orientation 保留。
  it("wins over the built-in orientation plugin in the full prebuild mod chain", async () => {
    const { getPrebuildConfigAsync } = require("@expo/prebuild-config") as {
      getPrebuildConfigAsync: (
        root: string,
        props: { platforms: string[]; packageName: string },
      ) => Promise<{ exp: Record<string, unknown> }>;
    };
    const { compileModsAsync } = require("@expo/config-plugins") as {
      compileModsAsync: (
        config: Record<string, unknown>,
        props: {
          projectRoot: string;
          platforms: string[];
          introspect: boolean;
          assertMissingModProviders: boolean;
        },
      ) => Promise<Record<string, unknown>>;
    };
    const { exp } = await getPrebuildConfigAsync(appRoot, {
      platforms: ["android"],
      packageName: "com.readany.app",
    });
    const config = (await compileModsAsync(exp, {
      projectRoot: appRoot,
      platforms: ["android"],
      introspect: true,
      assertMissingModProviders: false,
    })) as unknown as {
      orientation?: string;
      _internal: { modResults: { android: { manifest: Record<string, unknown> } } };
    };
    // 全局 orientation 仍为 portrait（iOS 使用），Android MainActivity 被覆盖
    expect(config.orientation).toBe("portrait");
    const modResults = config._internal.modResults.android.manifest;
    const root = (modResults.manifest ?? modResults) as {
      application: { activity: { $: Record<string, string> }[] }[];
    };
    const main = root.application[0].activity.find((a) => a.$["android:name"] === ".MainActivity");
    if (!main) throw new Error("MainActivity missing from compiled manifest");
    expect(main.$["android:screenOrientation"]).toBe("unspecified");
    expect(main.$["android:resizeableActivity"]).toBe("true");
    expect(main.$["android:maxAspectRatio"]).toBeUndefined();
    const changes = main.$["android:configChanges"] as string;
    expect(changes.split("|")).toContain("orientation");
    expect(changes.split("|")).toContain("screenLayout");
  }, 120_000);
});

// ─────────────────── 模板：执行真实主脚本（隔离 DOM 桩） ───────────────────

describe("reader template adaptive reflow", () => {
  let mainScript: string;

  beforeEach(() => {
    // 提取模板第一个 <script>（主脚本）：与构建产物注入方式一致。
    const html = readSource("packages/app-expo/assets/reader/reader.template.html");
    const start = html.indexOf("<script>");
    const end = html.indexOf("</script>", start);
    mainScript = html.slice(start + "<script>".length, end);
  });

  /** 执行模板主脚本并暴露步骤2的真实函数与状态（不重写实现）。 */
  function loadTemplateApi() {
    const src = mainScript;
    const noop = () => {};
    let clientWidth = 393;
    // 独立 renderer 工厂：换书用例需要第二份（独立属性表与写入计数）。
    const makeRenderer = () => {
      const attrs = new Map<string, string>();
      const events = new EventTarget();
      const restoredAnchors: unknown[] = [];
      let setCount = 0;
      return {
        attrs,
        restoredAnchors,
        getSetCount: () => setCount,
        renderer: {
          addEventListener: events.addEventListener.bind(events),
          removeEventListener: events.removeEventListener.bind(events),
          dispatchEvent: events.dispatchEvent.bind(events),
          scrollToAnchor: async (anchor: unknown) => {
            restoredAnchors.push(anchor);
            events.dispatchEvent(new CustomEvent("relocate", {
              detail: { reason: "navigation", range: { cloneRange: () => "restoration-page-start" } },
            }));
          },
          get clientWidth() {
            return clientWidth;
          },
          setAttribute: (k: string, v: string) => {
            attrs.set(k, String(v));
            setCount++;
          },
          removeAttribute: (k: string) => {
            attrs.delete(k);
          },
        },
      };
    };
    const first = makeRenderer();
    const renderer = first.renderer;
    const attrs = first.attrs;
    const getSetCount = first.getSetCount;
    // rAF 桩：id->fn 映射，真实 cancel 语义；flush 模拟帧执行。
    const rafMap = new Map<number, () => void>();
    let rafSeq = 0;
    const raf = (fn: () => void) => {
      const id = ++rafSeq;
      rafMap.set(id, fn);
      return id;
    };
    const cancelRaf = (id: number) => {
      rafMap.delete(id);
    };
    // ResizeObserver 桩：记录所有实例与回调，供测试直接强制调用
    // （包括已 disconnect 的旧实例——生产环境 disconnect 后浏览器不再
    // 回调，但我们要验证"即使回调来了也不生效"，所以桩不屏蔽）。
    class RO {
      cb: () => void;
      disconnected = false;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    }
    const roInstances: RO[] = [];
    const ROTest = class extends RO {
      constructor(cb: () => void) {
        super(cb);
        roInstances.push(this);
      }
    };
    const messages: { type: string; requestId?: string; count?: number; results?: unknown[] }[] =
      [];
    const win = {
      innerWidth: 393,
      addEventListener: noop,
      removeEventListener: noop,
      ReactNativeWebView: { postMessage: (message: string) => messages.push(JSON.parse(message)) },
    };
    const doc = {
      documentElement: { clientWidth: 393 },
      getElementById: () => null,
      addEventListener: noop,
      removeEventListener: noop,
      body: { appendChild: noop },
    };
    const fn = new Function(
      "window",
      "document",
      "ResizeObserver",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "getComputedStyle",
      "navigator",
      "matchMedia",
      "location",
      `${src}
; return { applyMobileReflowMargins, applySettings, applyRendererFlowMode, startReaderResizeObserver, stopReaderResizeObserver, handleSearch, clearReaderSearch, navigateToSearchResult, setVertical: (v) => { currentSectionUsesVerticalWriting = v; }, setView: (v) => { view = v; }, state: () => ({ currentPageMarginPx, currentPageMarginSetting, currentViewMode, currentFontSize }) };`,
    );
    const api = fn(
      win,
      doc,
      ROTest,
      raf,
      cancelRaf,
      () => ({ getPropertyValue: () => "" }),
      globalThis.navigator,
      () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
      { href: "file:///reader.html" },
    );
    return {
      api,
      messages,
      renderer,
      attrs,
      restoredAnchors: first.restoredAnchors,
      getSetCount,
      makeRenderer,
      setClientWidth: (w: number) => {
        clientWidth = w;
        win.innerWidth = w;
      },
      rafMap,
      flushRaf: () => {
        const fns = [...rafMap.values()];
        rafMap.clear();
        for (const f of fns) f();
      },
      /** 强制触发第 i 个（1 基）RO 实例回调——不检查 disconnected。 */
      forceRO: (i: number) => {
        const ro = roInstances[i - 1];
        if (ro) ro.cb();
      },
      roInstances,
    };
  }

  it("recomputes page width on narrow→wide→narrow without redundant writes", () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.api.applyMobileReflowMargins(t.renderer, 16);
    const narrowWidth = t.attrs.get("max-inline-size");
    expect(t.attrs.get("margin-top")).toBe("16px");
    expect(t.attrs.get("max-column-count")).toBe("1");
    expect(Number.parseFloat(narrowWidth ?? "")).toBeGreaterThan(380);

    const before = t.getSetCount();
    t.api.applyMobileReflowMargins(t.renderer, 16);
    expect(t.getSetCount()).toBe(before); // 同尺寸同边距去重

    t.setClientWidth(840);
    t.api.applyMobileReflowMargins(t.renderer, 16);
    expect(t.attrs.get("max-column-count")).toBe("2");
    expect(Number.parseFloat(t.attrs.get("max-inline-size") ?? "")).toBeLessThan(440);

    t.setClientWidth(393);
    t.api.applyMobileReflowMargins(t.renderer, 16);
    expect(t.attrs.get("max-column-count")).toBe("1");
    expect(t.attrs.get("max-inline-size")).toBe(narrowWidth);
  });

  it("scales margin with real fontSize: applySettings(fontSize 32, margin 16) → 32px", () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.api.applySettings({ pageMargin: 16 });
    expect(t.api.state().currentPageMarginPx).toBe(16);
    t.api.applySettings({ fontSize: 32 });
    expect(t.api.state().currentPageMarginPx).toBe(32); // 16 × 32/16
    expect(t.attrs.get("margin-top")).toBe("32px");
  });

  it("keeps scroll/fixed modes out of the paginated margin rules", () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.api.applySettings({ pageMargin: 16, viewMode: "scroll" });
    expect(t.api.state().currentViewMode).toBe("scroll");
    expect(t.attrs.get("max-inline-size")).toBe("9999px"); // 流式宽度不被分页规则覆盖
    t.api.applySettings({ fontSize: 24 });
    expect(t.attrs.get("max-inline-size")).toBe("9999px");
    expect(t.api.state().currentPageMarginPx).toBe(Math.round(16 * (24 / 16))); // 记录仍缩放

    // 固定排版：属性不触碰
    t.api.setView({ isFixedLayout: true, renderer: t.renderer });
    const fixedSnapshot = new Map(t.attrs);
    t.api.applySettings({ fontSize: 28 });
    for (const [k, v] of fixedSnapshot) expect(t.attrs.get(k)).toBe(v);
  });

  it("recomputes paginated width when switching scroll→paginated via real applySettings", () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.api.applySettings({ pageMargin: 16, viewMode: "scroll" });
    expect(t.attrs.get("max-inline-size")).toBe("9999px");
    t.setClientWidth(840);
    t.api.applySettings({ viewMode: "paginated" });
    expect(t.attrs.get("max-column-count")).toBe("2");
    expect(Number.parseFloat(t.attrs.get("max-inline-size") ?? "")).toBeLessThan(440);
  });

  it("coalesces resize callbacks in one rAF and reapplies at the current margin", () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.api.applySettings({ pageMargin: 16 });
    t.api.startReaderResizeObserver({});
    t.setClientWidth(840);
    t.forceRO(1);
    expect(t.rafMap.size).toBe(1);
    t.forceRO(1); // 连续回调合并
    expect(t.rafMap.size).toBe(1);
    t.setClientWidth(700);
    t.flushRaf();
    expect(t.attrs.get("max-column-count")).toBe("2");
    expect(Number.parseFloat(t.attrs.get("max-inline-size") ?? "")).toBeLessThan(370);
    t.setClientWidth(0); // 瞬态无效宽：resize 无害
    t.forceRO(1);
    t.flushRaf();
    // clientWidth 0 会走 window.innerWidth 回退（已同步为 0）→ documentElement 393
    expect(Number(t.attrs.get("max-inline-size")?.replace("px", ""))).toBeGreaterThan(0);
  });

  it("uses remaining width, font size and preference without changing the book instance", () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.setClientWidth(960);
    t.api.applySettings({ fontSize: 16, pageMargin: 16, paginatedLayout: "double" });
    expect(t.attrs.get("max-column-count")).toBe("2");
    t.setClientWidth(640);
    t.api.applyMobileReflowMargins(t.renderer, 16);
    expect(t.attrs.get("max-column-count")).toBe("2");
    t.setClientWidth(520);
    t.api.applyMobileReflowMargins(t.renderer, 16);
    expect(t.attrs.get("max-column-count")).toBe("1");
    t.setClientWidth(960);
    t.api.applyMobileReflowMargins(t.renderer, 16);
    expect(t.attrs.get("max-column-count")).toBe("2");
    t.api.applySettings({ fontSize: 32 });
    expect(t.attrs.get("max-column-count")).toBe("1");
    t.api.applySettings({ fontSize: 16, paginatedLayout: "single" });
    expect(t.attrs.get("max-column-count")).toBe("1");
    expect(Number.parseFloat(t.attrs.get("max-inline-size") ?? "")).toBeLessThanOrEqual(608);
    t.api.applySettings({ paginatedLayout: "double" });
    expect(t.attrs.get("max-column-count")).toBe("2");
    t.api.setVertical(true);
    t.api.applyRendererFlowMode(t.renderer);
    expect(t.attrs.get("max-column-count")).toBe("1");
    t.api.setVertical(false);
    t.api.applyRendererFlowMode(t.renderer);
    expect(t.attrs.get("max-column-count")).toBe("2");
  });

  it("preserves the text anchor across repeated reflow without replacing it with the new page start", async () => {
    const t = loadTemplateApi();
    t.api.setView({ isFixedLayout: false, renderer: t.renderer });
    t.api.applySettings({ pageMargin: 16 });
    t.api.startReaderResizeObserver({});
    const original = { collapse: (toStart: boolean) => expect(toStart).toBe(true) };
    const later = { collapse: (toStart: boolean) => expect(toStart).toBe(true) };
    const relocate = (reason: string, range: unknown) => t.renderer.dispatchEvent(
      new CustomEvent("relocate", { detail: { reason, range: { cloneRange: () => range } } }),
    );
    relocate("navigation", original);
    for (const width of [960, 640, 520, 390, 840, 1280, 960]) {
      relocate("anchor", later);
      relocate("container-scroll", later);
      t.setClientWidth(width);
      t.forceRO(1);
      t.flushRaf();
      await Promise.resolve();
      await Promise.resolve();
      expect(t.restoredAnchors.at(-1)).toBe(original);
    }
    // 用户翻页后应更新锚点；切字号仍沿用该文本，停止订阅后不再恢复。
    relocate("page", later);
    t.api.applySettings({ fontSize: 32 });
    expect(t.restoredAnchors.at(-1)).toBe(later);
    t.api.stopReaderResizeObserver();
    const count = t.restoredAnchors.length;
    t.forceRO(1);
    t.flushRaf();
    t.api.applySettings({ fontSize: 18 });
    expect(t.restoredAnchors).toHaveLength(count);
  });

  it("rejects late searches and clears old annotations before a replacement starts", async () => {
    const t = loadTemplateApi();
    let resolveOld: (value: unknown) => void = () => {};
    let oldStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    const goTo: string[] = [];
    let clears = 0;
    const target = {
      clearSearch: () => {
        clears++;
      },
      goTo: async (cfi: string) => {
        goTo.push(cfi);
      },
      search: async function* ({ query }: { query: string }) {
        if (query === "old") {
          oldStarted();
          await new Promise((resolve) => {
            resolveOld = resolve;
          });
        }
        yield {
          label: query,
          subitems: [{ cfi: query, excerpt: { pre: "before ", match: query, post: " after" } }],
        };
      },
    };
    t.api.setView(target);
    const oldSearch = t.api.handleSearch("old", "1");
    await started;
    const replacement = t.api.handleSearch("new", "2");
    resolveOld(null);
    await Promise.all([oldSearch, replacement]);
    expect(clears).toBe(2);
    expect(t.messages.filter((message) => message.type === "searchComplete")).toEqual([
      {
        type: "searchComplete",
        requestId: "2",
        count: 1,
        results: [{ cfi: "new", chapter: "new", excerpt: "before new after" }],
      },
    ]);
    expect(goTo).toEqual(["new"]);
    await t.api.clearReaderSearch("3");
    await t.api.navigateToSearchResult(0, "2");
    expect(goTo).toEqual(["new"]);
  });

  it("a new book invalidates a pending search before it can navigate", async () => {
    const t = loadTemplateApi();
    let release: () => void = () => {};
    let announce: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const goTo: string[] = [];
    t.api.setView({
      clearSearch: () => {},
      goTo: async (cfi: string) => {
        goTo.push(cfi);
      },
      search: async function* () {
        announce();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield { cfi: "old-book", excerpt: "old" };
      },
    });
    const pending = t.api.handleSearch("old", "1");
    await started;
    const cleanup = t.api.clearReaderSearch(null);
    t.api.setView({
      clearSearch: () => {},
      goTo: async () => {
        throw new Error("must not navigate new book");
      },
    });
    release();
    await Promise.all([pending, cleanup]);
    expect(goTo).toEqual([]);
    expect(t.messages.filter((message) => message.type.startsWith("search"))).toEqual([]);
  });

  it("stale observer callbacks and queued rAF closures cannot touch a new book", () => {
    const t = loadTemplateApi();
    const oldBook = t.renderer;
    t.api.setView({ isFixedLayout: false, renderer: oldBook });
    t.api.applySettings({ pageMargin: 16 });
    t.api.startReaderResizeObserver({});
    t.setClientWidth(840);
    t.forceRO(1); // 旧 observer 回调入队一帧 rAF
    expect(t.rafMap.size).toBe(1);
    // 换书前保存被取消前已入队的旧 rAF 闭包（stop 会 cancel，不依赖 map）
    const staleRaf = [...t.rafMap.values()][0];
    expect(staleRaf).toBeTypeOf("function");

    // 换书（openBook 开头）：stop + 清理，再挂一份独立 renderer 的新 view
    t.api.stopReaderResizeObserver();
    expect(t.rafMap.size).toBe(0); // 待执行 rAF 已取消
    const next = t.makeRenderer();
    t.api.setView({ isFixedLayout: false, renderer: next.renderer }); // 新书 view
    t.api.startReaderResizeObserver({}); // 新书 observer（实例 2）

    // 新书正常活跃：新 observer 触发 -> 新 renderer 按新宽度写入
    t.setClientWidth(600);
    t.forceRO(2);
    t.flushRaf();
    const newWidth = next.attrs.get("max-inline-size");
    expect(newWidth).toBeTypeOf("string"); // 新书正常重排
    expect(next.getSetCount()).toBeGreaterThan(0);

    // 旧 observer 回调 + 已取消的旧 rAF 闭包直接强制调用（桩不屏蔽 disconnect）：
    // 对旧书与新书均零新写入、零新 rAF 排队（代数失效）。
    const oldWrites = t.getSetCount();
    const newWrites = next.getSetCount();
    const rafBefore = t.rafMap.size;
    t.setClientWidth(500); // 与换书时刻不同的宽度
    t.forceRO(1); // 旧 observer 回调
    staleRaf(); // 已取消的旧 rAF 闭包
    expect(t.getSetCount()).toBe(oldWrites); // 旧书零写入
    expect(next.getSetCount()).toBe(newWrites); // 新书零写入
    expect(t.rafMap.size).toBe(rafBefore); // 无新 rAF 排队
    expect(next.attrs.get("max-inline-size")).toBe(newWidth); // 新书属性不变
  });
});

