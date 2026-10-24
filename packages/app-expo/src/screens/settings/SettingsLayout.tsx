import { ChevronRightIcon } from "@/components/ui/Icon";
import { useContentLayout } from "@/hooks/use-responsive-layout";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { refreshAndCountUnreadFeedback } from "@readany/core/feedback";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  SETTINGS_ENTRIES,
  settingsCategory,
  settingsCategoryAction,
} from "./settings-navigation";
import { SETTINGS_ICONS } from "./settings-icons";

export function SettingsLayout({ children }: { children: ReactNode }) {
  const layout = useContentLayout();
  const colors = useColors();
  const { t } = useTranslation();
  const route = useRoute();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const selected = settingsCategory(route.name);
  const [unread, setUnread] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refreshAndCountUnreadFeedback()
        .then((count) => {
          if (active) setUnread(count);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["left", "right", "bottom"]}
    >
      <View
        onLayout={layout.onContentLayout}
        style={{
          flex: 1,
          flexDirection: "row",
          marginHorizontal: layout.horizontalPadding,
          gap: layout.supportsSplitView ? 20 : 0,
        }}
      >
        <SafeAreaView
          edges={["top"]}
          style={{
            display: layout.supportsSplitView ? "flex" : "none",
            width: 208,
            borderRightWidth: 0.5,
            borderRightColor: colors.border,
          }}
        >
          <ScrollView
            contentContainerStyle={{ paddingTop: 24, paddingRight: 16, paddingBottom: 24 }}
          >
            <Text
              style={{
                fontSize: fontSize.xl,
                fontWeight: fontWeight.semibold,
                color: colors.foreground,
                marginBottom: 24,
              }}
            >
              {t("settings.title", "设置")}
            </Text>
            {SETTINGS_ENTRIES.map((entry, index) => {
              const Icon = SETTINGS_ICONS[entry.icon];
              const active = selected === entry.route;
              return (
                <View key={entry.route}>
                  {(index === 0 || SETTINGS_ENTRIES[index - 1].group !== entry.group) && (
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: fontSize.xs,
                        marginTop: index ? 20 : 0,
                        marginBottom: 8,
                      }}
                    >
                      {t(entry.group)}
                    </Text>
                  )}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      const action = settingsCategoryAction(nav.getState(), entry.route);
                      if (action) nav.dispatch(action);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      minHeight: 48,
                      paddingHorizontal: 10,
                      borderRadius: radius.lg,
                      backgroundColor: active ? colors.muted : "transparent",
                    }}
                  >
                    <Icon size={18} color={active ? colors.primary : colors.mutedForeground} />
                    <Text
                      style={{
                        color: active ? colors.primary : colors.foreground,
                        fontSize: fontSize.sm,
                        flex: 1,
                      }}
                    >
                      {t(entry.label)}
                    </Text>
                    {entry.route === "Feedback" && unread > 0 ? (
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: colors.destructive,
                        }}
                      />
                    ) : (
                      <ChevronRightIcon size={12} color={colors.mutedForeground} />
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
        <View
          key="settings-content"
          style={{ flex: 1, minWidth: 0, maxWidth: 760, marginHorizontal: "auto" }}
        >
          {children}
        </View>
      </View>
    </SafeAreaView>
  );
}
