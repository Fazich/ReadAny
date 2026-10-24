import { BookOpenIcon, MessageSquareIcon, NotebookPenIcon, UserIcon } from "@/components/ui/Icon";
import { getNavigationBottomInset, NAVIGATION_RAIL_WIDTH } from "@/hooks/responsive-layout";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { ChatScreen } from "@/screens/ChatScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useTheme } from "@/styles/ThemeContext";
/**
 * TabNavigator — four tabs on a right rail in landscape and a bottom bar otherwise.
 * Icons: BookOpen, MessageSquare, NotebookPen, User (matching BottomTabBar.tsx)
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type TabParamList = {
  Library: undefined;
  Chat: undefined;
  Notes: { bookId?: string } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();

  const bottomInset = getNavigationBottomInset(insets.bottom, Platform.OS === "android", layout.isTablet);

  const rail = layout.useNavigationRail;
  const tabBarHeight = 60 + bottomInset;

  return (
    <Tab.Navigator
      safeAreaInsets={{ ...insets, bottom: bottomInset }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: false,
        tabBarPosition: rail ? "right" : "bottom",
        tabBarVariant: rail ? "material" : "uikit",
        tabBarLabelPosition: "below-icon",
        tabBarActiveBackgroundColor: rail ? colors.muted : "transparent",
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
        },
        tabBarItemStyle: rail ? { minHeight: 64, marginVertical: 4 } : { minHeight: 44 },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: rail ? 0 : 0.5,
          borderLeftColor: colors.border,
          ...(rail
            ? {
                width: NAVIGATION_RAIL_WIDTH + insets.right,
                paddingStart: 8,
                paddingEnd: 8 + insets.right,
              }
            : { paddingTop: 4, paddingBottom: bottomInset, height: tabBarHeight }),
        },
        sceneStyle: {
          paddingLeft: rail ? insets.left : 0,
          paddingBottom: rail
            ? bottomInset
            : Platform.OS === "android" && insets.bottom === 0
              ? 4
              : 0,
        },
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          tabBarLabel: t("tabs.library", "书架"),
          tabBarIcon: ({ color, size }) => <BookOpenIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarLabel: t("tabs.ai", "AI"),
          tabBarIcon: ({ color, size }) => <MessageSquareIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{
          tabBarLabel: t("tabs.notes", "笔记"),
          tabBarIcon: ({ color, size }) => <NotebookPenIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t("tabs.profile", "我的"),
          tabBarIcon: ({ color, size }) => <UserIcon color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
