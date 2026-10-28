import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as layoutApi from "../../lib/reader/reader-ai-layout";
import {
  DEFAULT_READER_AI_PANEL_RATIO,
  READER_AI_DIVIDER_WIDTH,
  READER_AI_PANEL_MIN_WIDTH,
  READER_AI_SPLIT_MIN_WIDTH,
  clampReaderAIPanelWidth,
  getReaderAIPanelRatio,
  getReaderAIPanelWidth,
  getReaderAIPanelWidthAfterDrag,
  getReaderAISplitLayout,
  normalizeReaderAIPanelRatio,
} from "../../lib/reader/reader-ai-layout";

// 仅替换外部原生环境；布局、组件回调与 store 均执行真实源码。
function loadSource(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" });
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  new Function("module", "exports", "require", "setTimeout", code)(
    module,
    module.exports,
    (name: string) => (name in dependencies ? dependencies[name] : nodeRequire(name)),
    () => 0,
  );
  return module.exports;
}

interface TestElement {
  type: unknown;
  props: Record<string, unknown>;
}

function loadResizeHandle() {
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let responderConfig: Record<string, (...args: never[]) => unknown>;
  const jsx = (type: unknown, props: Record<string, unknown>): TestElement => ({ type, props });
  const module = loadSource("./ReaderAIResizeHandle.tsx", {
    "@/styles/theme": { useColors: () => ({ border: "border", mutedForeground: "muted" }) },
    "@/lib/reader/reader-ai-layout": layoutApi,
    react: {
      useRef: (current: unknown) => {
        const index = cursor++;
        if (!refs[index]) refs[index] = { current };
        return refs[index];
      },
      useState: (initial: () => unknown) => [initial()],
      useLayoutEffect: (effect: () => undefined | (() => void)) => {
        effect();
      },
    },
    "react-native": {
      PanResponder: {
        create: (config: Record<string, (...args: never[]) => unknown>) => {
          responderConfig = config;
          return {
            panHandlers: {
              onGrant: config.onPanResponderGrant,
              onMove: config.onPanResponderMove,
              onRelease: config.onPanResponderRelease,
              onTerminate: config.onPanResponderTerminate,
            },
          };
        },
      },
      StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
      View: "View",
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  return {
    render(props: Record<string, unknown>) {
      cursor = 0;
      return (module.ReaderAIResizeHandle as (props: Record<string, unknown>) => TestElement)(
        props,
      );
    },
    get config() {
      return responderConfig ?? {};
    },
  };
}

const gestureEvent = (pageX: number) => ({ nativeEvent: { pageX } });

function loadSettingsStore() {
  let state: Record<string, unknown>;
  let migrate: (state: Record<string, unknown>) => Record<string, unknown> = (value) => value;
  const create =
    () => (initializer: (set: (update: unknown) => void, get: () => unknown) => unknown) => {
      state = initializer(
        (update) => {
          const patch =
            typeof update === "function" ? (update as (value: unknown) => unknown)(state) : update;
          state = { ...state, ...(patch as object) };
        },
        () => state,
      ) as Record<string, unknown>;
      return { getState: () => state };
    };
  const module = loadSource("../../stores/settings-store.ts", {
    "@readany/core/ai/request-debug": {
      logAIEndpointDebug: () => {},
      summarizeDebugText: (text: string) => text,
    },
    "@readany/core/utils/api": {
      buildProviderModelsUrl: () => "",
      providerRequiresApiKey: () => false,
      providerSupportsExactRequestUrl: () => false,
    },
    zustand: { create },
    "../lib/reader/reader-ai-layout": layoutApi,
    "./persist": {
      deleteSecure: async () => {},
      loadSecure: async () => "",
      saveSecure: async () => {},
      withPersist: (
        _key: string,
        creator: unknown,
        _options: unknown,
        migration: typeof migrate,
      ) => {
        migrate = migration;
        return creator;
      },
    },
  });
  return {
    store: module.useSettingsStore as unknown as { getState: () => Record<string, unknown> },
    migrate,
  };
}

describe("reader AI split layout", () => {
  const input = {
    availableWidth: 680,
    windowWidth: 900,
    windowHeight: 600,
    panelRatio: DEFAULT_READER_AI_PANEL_RATIO,
  };

  it("enables at 680dp, but not 679dp", () => {
    expect(READER_AI_SPLIT_MIN_WIDTH).toBe(680);
    expect(getReaderAISplitLayout(input)).toMatchObject({
      readerWidth: 336,
      aiWidth: 320,
      dividerWidth: READER_AI_DIVIDER_WIDTH,
    });
    expect(getReaderAISplitLayout({ ...input, availableWidth: 679 })).toBeNull();
  });

  it("按实际窗口方向切换分栏", () => {
    expect(
      getReaderAISplitLayout({ ...input, windowWidth: 1000, windowHeight: 800 }),
    ).not.toBeNull();
    expect(getReaderAISplitLayout({ ...input, windowWidth: 800, windowHeight: 1000 })).toBeNull();
    expect(getReaderAISplitLayout({ ...input, windowHeight: 900 })).toBeNull();
  });

  it("uses safe-area available width rather than total window width", () => {
    expect(getReaderAISplitLayout({ ...input, windowWidth: 1000, availableWidth: 679 })).toBeNull();
  });

  it("rejects invalid dimensions without producing non-finite widths", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      expect(getReaderAISplitLayout({ ...input, availableWidth: value })).toBeNull();
      expect(getReaderAISplitLayout({ ...input, windowWidth: value })).toBeNull();
      expect(getReaderAISplitLayout({ ...input, windowHeight: value })).toBeNull();
    }
    expect(clampReaderAIPanelWidth(Number.NaN, 1000)).toBeCloseTo(390.4);
    expect(clampReaderAIPanelWidth(320, Number.NaN)).toBe(0);
    expect(getReaderAIPanelRatio(Number.NaN, 1000)).toBe(0.4);
    expect(getReaderAIPanelRatio(320, 0)).toBe(0.4);
  });

  it("clamps actual width while leaving the preferred ratio untouched", () => {
    expect(READER_AI_PANEL_MIN_WIDTH).toBe(320);
    expect(clampReaderAIPanelWidth(100, 800)).toBe(320);
    expect(clampReaderAIPanelWidth(900, 800)).toBe(456);
    expect(getReaderAIPanelWidth(680, 0.4)).toBe(320);
    expect(getReaderAIPanelRatio(320, 680)).toBeCloseTo(320 / 656);
    expect(getReaderAIPanelWidth(1000, 0.4)).toBeCloseTo(390.4);
    const preference = { ...input, panelRatio: 0.75 };
    expect(getReaderAISplitLayout(preference)?.aiWidth).toBe(336);
    expect(preference.panelRatio).toBe(0.75);
    const expanded = getReaderAISplitLayout({ ...preference, availableWidth: 1600 });
    expect(expanded).toMatchObject({ aiWidth: 1182, readerWidth: 394 });
    expect(getReaderAIPanelRatio(1182, 1600)).toBe(0.75);
    for (const ratio of [0.01, 0.4, 0.99]) {
      const layout = getReaderAISplitLayout({ ...input, panelRatio: ratio });
      expect(layout?.aiWidth).toBeGreaterThanOrEqual(320);
      expect(layout?.readerWidth).toBeGreaterThanOrEqual(320);
    }
  });

  it("falls back for non-finite or out-of-range ratios", () => {
    for (const ratio of [Number.NaN, Number.POSITIVE_INFINITY, 0, 1, -0.1, 1.1]) {
      expect(normalizeReaderAIPanelRatio(ratio)).toBe(DEFAULT_READER_AI_PANEL_RATIO);
    }
    expect(normalizeReaderAIPanelRatio(0.65)).toBe(0.65);
    expect(normalizeReaderAIPanelRatio(0.001)).toBe(0.001);
    expect(normalizeReaderAIPanelRatio(0.999)).toBe(0.999);
    expect(normalizeReaderAIPanelRatio("0.65" as unknown as number)).toBe(0.4);
  });

  it("maps left drag to a wider AI panel and right drag to a narrower one", () => {
    expect(getReaderAIPanelWidthAfterDrag(360, 500, 450, 320, 556)).toBe(410);
    expect(getReaderAIPanelWidthAfterDrag(360, 500, 520, 320, 556)).toBe(340);
    expect(getReaderAIPanelWidthAfterDrag(360, 500, 900, 320, 556)).toBe(320);
    expect(getReaderAIPanelWidthAfterDrag(360, 500, 0, 320, 556)).toBe(556);
    expect(getReaderAIPanelWidthAfterDrag(360, 500, Number.NaN, 320, 556)).toBe(360);
  });
});

describe("AI 面板拖动手柄", () => {
  const callbacks = () => ({ onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() });
  const props = (
    handlers: ReturnType<typeof callbacks>,
    overrides: Record<string, unknown> = {},
  ) => ({
    width: 360,
    minWidth: 320,
    maxWidth: 556,
    layoutKey: "landscape-900x600",
    visible: true,
    ...handlers,
    ...overrides,
  });

  it("松手按边界宽度更新并只提交一次", () => {
    const host = loadResizeHandle();
    const handlers = callbacks();
    host.render(props(handlers));
    host.config.onPanResponderGrant(gestureEvent(500) as never);
    host.config.onPanResponderMove(gestureEvent(0) as never);
    expect(handlers.onChange).toHaveBeenLastCalledWith(556);
    host.config.onPanResponderRelease(gestureEvent(0) as never);
    expect(handlers.onChange).toHaveBeenLastCalledWith(556);
    expect(handlers.onCommit).toHaveBeenCalledExactlyOnceWith(556);
  });

  it("layout 变化、隐藏和 terminate 取消手势且不提交", () => {
    for (const scenario of ["layout", "hidden", "terminate"]) {
      const host = loadResizeHandle();
      const handlers = callbacks();
      host.render(props(handlers));
      host.config.onPanResponderGrant(gestureEvent(500) as never);
      if (scenario === "terminate") host.config.onPanResponderTerminate();
      else
        host.render(
          props(
            handlers,
            scenario === "hidden" ? { visible: false } : { layoutKey: "portrait-600x900" },
          ),
        );
      host.config.onPanResponderRelease(gestureEvent(450) as never);
      expect(handlers.onCommit).not.toHaveBeenCalled();
      expect(handlers.onCancel).toHaveBeenCalledOnce();
    }
  });

  it("提供 adjustable 无障碍信息、动作及边界约束", () => {
    const host = loadResizeHandle();
    const handlers = callbacks();
    const tree = host.render(props(handlers)) as TestElement;
    expect(tree.props).toMatchObject({
      accessible: true,
      accessibilityRole: "adjustable",
      accessibilityLabel: "AI 面板宽度",
      accessibilityValue: { min: 320, max: 556, now: 360 },
      accessibilityActions: [
        { name: "increment", label: "增加 AI 面板宽度" },
        { name: "decrement", label: "减少 AI 面板宽度" },
      ],
    });
    const action = tree.props.onAccessibilityAction as (event: unknown) => void;
    action({ nativeEvent: { actionName: "increment" } });
    expect(handlers.onCommit).toHaveBeenLastCalledWith(376);
    action({ nativeEvent: { actionName: "decrement" } });
    expect(handlers.onCommit).toHaveBeenLastCalledWith(344);
    const boundaryTree = host.render(props(handlers, { width: 550 }));
    (boundaryTree.props.onAccessibilityAction as (event: unknown) => void)({
      nativeEvent: { actionName: "increment" },
    });
    expect(handlers.onCommit).toHaveBeenLastCalledWith(556);
  });
});

describe("阅读设置中的 AI 面板比例", () => {
  it("setter 规范化比例但不改 settingsUpdatedAt，reset 恢复默认值", async () => {
    const { store } = loadSettingsStore();
    const initialTimestamp = store.getState().settingsUpdatedAt;
    (store.getState().setReaderAiPanelRatio as (ratio: number) => void)(0.7);
    expect(store.getState().readerAiPanelRatio).toBe(0.7);
    expect(store.getState().settingsUpdatedAt).toBe(initialTimestamp);
    (store.getState().setReaderAiPanelRatio as (ratio: number) => void)(2);
    expect(store.getState().readerAiPanelRatio).toBe(DEFAULT_READER_AI_PANEL_RATIO);
    await (store.getState().resetToDefaults as () => Promise<void>)();
    expect(store.getState().readerAiPanelRatio).toBe(DEFAULT_READER_AI_PANEL_RATIO);
  });

  it("迁移缺失或非法比例为默认值，并保留有效比例", () => {
    const { migrate } = loadSettingsStore();
    const state = { aiConfig: { maxTokens: 8192 }, readSettings: { useBookFonts: true } };
    expect(migrate(state).readerAiPanelRatio).toBe(DEFAULT_READER_AI_PANEL_RATIO);
    expect(migrate({ ...state, readerAiPanelRatio: 4 }).readerAiPanelRatio).toBe(
      DEFAULT_READER_AI_PANEL_RATIO,
    );
    expect(migrate({ ...state, readerAiPanelRatio: 0.6 }).readerAiPanelRatio).toBe(0.6);
  });
});
