import { describe, expect, it } from "vitest";
import { settingsCategory, settingsCategoryAction } from "./settings-navigation";

describe("设置分类导航", () => {
  it("切换分类不累积设置历史，并保留书籍入口和key", () => {
    const tabs = { name: "Tabs", key: "tabs" };
    const book = { name: "BookChat", key: "book-chat", params: { bookId: "book-1" } };
    const action = settingsCategoryAction(
      {
        index: 3,
        routes: [
          tabs,
          book,
          { name: "AISettings", key: "ai" },
          { name: "SyncSettings", key: "sync" },
        ],
      },
      "AppearanceSettings",
    );
    expect(action).toEqual({
      type: "RESET",
      payload: { index: 2, routes: [tabs, book, { name: "AppearanceSettings" }] },
    });
    expect(action?.payload.routes[1]).toBe(book);
  });

  it("反馈详情归反馈分类，切换其它分类会移除整个设置尾栈", () => {
    expect(settingsCategory("FeedbackDetail")).toBe("Feedback");
    expect(settingsCategory("Reader")).toBeUndefined();
    const state = {
      index: 2,
      routes: [
        { name: "Tabs", key: "tabs" },
        { name: "Feedback", key: "feedback" },
        { name: "FeedbackDetail", key: "detail", params: { issueNumber: 1 } },
      ],
    };
    expect(settingsCategoryAction(state, "Feedback")?.payload.routes).toEqual(
      state.routes.slice(0, 2),
    );
    expect(
      settingsCategoryAction(state, "FontSettings")?.payload.routes.map((route) => route.name),
    ).toEqual(["Tabs", "FontSettings"]);
  });

  it("当前分类不重开，也不恢复index后的旧页面", () => {
    expect(
      settingsCategoryAction({ index: 0, routes: [{ name: "AISettings" }] }, "AISettings"),
    ).toBeUndefined();
    expect(
      settingsCategoryAction(
        {
          index: 0,
          routes: [
            { name: "Tabs", key: "tabs" },
            { name: "Reader", key: "stale" },
          ],
        },
        "AISettings",
      )?.payload.routes,
    ).toEqual([{ name: "Tabs", key: "tabs" }, { name: "AISettings" }]);
  });
});
