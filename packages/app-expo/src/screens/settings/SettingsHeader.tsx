import { CommonActions, type NavigationProp, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronLeftIcon } from "../../components/ui/Icon";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { fontSize, fontWeight, spacing, useColors } from "../../styles/theme";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function SettingsHeader({ title, subtitle, right }: Props) {
  const nav = useNavigation<NavigationProp<RootStackParamList>>();
  const colors = useColors();
  const { t } = useTranslation();

  const handleBack = () => {
    if (nav.canGoBack()) {
      nav.goBack();
      return;
    }
    nav.dispatch(CommonActions.navigate("Tabs"));
  };

  return (
    <View
      style={[
        styles.header,
        { borderBottomColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <View style={[styles.headerInner, { maxWidth: 760 }]}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeftIcon size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.rightSlot}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingBottom: 12,
    paddingTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -4,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  titleWrap: {
    flex: 1,
  },
  subtitle: {
    fontSize: fontSize.xs,
    marginTop: 1,
    opacity: 0.82,
  },
  rightSlot: {
    flexDirection: "row",
    alignItems: "center",
  },
});
