import { BookChatContent } from "@/components/chat/BookChatContent";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CitationPart } from "@readany/core/types/message";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "BookChat">;

/** 独立书籍对话仅负责安全区和导航；共享内容不依赖路由参数。 */
export function BookChatScreen({ route, navigation }: Props) {
  const { bookId, selectedText, chapterTitle } = route.params;
  const { t } = useTranslation();
  const colors = useColors();
  const layout = useResponsiveLayout();
  const selectionRequest = useMemo(
    () =>
      selectedText
        ? {
            id: `${route.key}:${Date.now()}`,
            text: selectedText,
            chapterTitle,
          }
        : undefined,
    [chapterTitle, route.key, selectedText],
  );
  const handleClose = useCallback(() => navigation.goBack(), [navigation]);
  const handleNavigateToSettings = useCallback(
    () => navigation.navigate("AISettings"),
    [navigation],
  );
  const handleCitationClick = useCallback(
    (citation: CitationPart) => {
      if (citation.bookId === bookId && citation.cfi) {
        void openMobileBook({ bookId, navigation, t, cfi: citation.cfi, highlight: true });
      } else if (citation.bookId) {
        void openMobileBook({
          bookId: citation.bookId,
          navigation,
          t,
          cfi: citation.cfi,
          highlight: true,
        });
      }
    },
    [bookId, navigation, t],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <View style={{ flex: 1, marginHorizontal: layout.horizontalPadding }}>
        <BookChatContent
          key={bookId}
          bookId={bookId}
          onClose={handleClose}
          onNavigateToSettings={handleNavigateToSettings}
          onCitationClick={handleCitationClick}
          selectionRequest={selectionRequest}
        />
      </View>
    </SafeAreaView>
  );
}
