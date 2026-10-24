import type { RootStackParamList } from "@/navigation/RootNavigator";

export const SETTINGS_ENTRIES = [
  {
    route: "AppearanceSettings",
    label: "settings.general",
    icon: "Palette",
    group: "settings.general",
  },
  { route: "FontSettings", label: "fonts.title", icon: "Type", group: "settings.general" },
  { route: "SyncSettings", label: "settings.sync", icon: "Cloud", group: "settings.general" },
  { route: "AISettings", label: "settings.ai_title", icon: "Database", group: "settings.skills" },
  { route: "TTSSettings", label: "tts.title", icon: "Volume2", group: "settings.skills" },
  {
    route: "TranslationSettings",
    label: "settings.translationTab",
    icon: "Languages",
    group: "settings.skills",
  },
  {
    route: "VectorModelSettings",
    label: "settings.vm_title",
    icon: "Cpu",
    group: "settings.skills",
  },
  { route: "Feedback", label: "feedback.title", icon: "MessageSquare", group: "settings.other" },
  { route: "About", label: "settings.about", icon: "Info", group: "settings.other" },
] as const satisfies readonly {
  route: keyof RootStackParamList;
  label: string;
  icon: string;
  group: string;
}[];

export type SettingsRoute = (typeof SETTINGS_ENTRIES)[number]["route"];

export function settingsCategory(route: string): SettingsRoute | undefined {
  if (route === "FeedbackDetail") return "Feedback";
  return SETTINGS_ENTRIES.find((entry) => entry.route === route)?.route;
}

// 同级分类替换整个设置尾栈，保留进入设置前的页面及其 key。
export function settingsCategoryAction(
  state: { index: number; routes: readonly { name: string; key?: string; params?: object }[] },
  target: SettingsRoute,
) {
  const routes = state.routes.slice(0, state.index + 1);
  if (routes.at(-1)?.name === target) return undefined;
  let start = routes.length;
  while (start > 0 && settingsCategory(routes[start - 1].name)) start--;
  const existing = routes.slice(start).find((route) => route.name === target);
  const nextRoutes = [...routes.slice(0, start), existing ?? { name: target }];
  return { type: "RESET", payload: { index: nextRoutes.length - 1, routes: nextRoutes } };
}
