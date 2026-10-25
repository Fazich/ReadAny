# 阔折叠与横屏大屏设计计划

## Context

用户提供展开横屏下「我的」页截图，认为当前界面只是将手机布局拉伸，希望提升大屏空间利用与操作体验。已确认方案需覆盖其他主页面、阅读器与设置。方案已获批准并完成实施步骤 5–9；步骤 10 的本机自动检查与阅读器浏览器验收已完成，主页面、设置与听书仍待原生设备验收。结果及截图见 [验收记录](./foldable-large-screen-verification.md)。

后续「阔折叠外屏」增量把目标改为外屏、短窗口及键盘打开时内容完整可达：缩小装饰、保留全部入口，给空态、浮层和听书单列加可滚约束。实现与证据见验收记录的「阔折叠外屏布局：增量验收（2026-10-25）」。

实施前的代码核查结论：

- 截图中的四项统计仍为两行大卡片，设置入口被推到首屏以下；底部四个导航项横向铺开，占用了横屏下有限的高度。
- `packages/app-expo/src/hooks/use-responsive-layout.ts` 使用 `shortestSide >= 768 || (shortestSide >= 600 && longestSide >= 960)` 判断平板。当前可用宽度足够、但短边或长边未达条件的窗口仍走手机布局。截图没有逻辑尺寸，不能仅凭图片像素断定设备命中了哪个条件。
- `packages/app-expo/src/screens/ProfileScreen.tsx` 仅用 `layout.isTablet ? 4 : 2` 改变统计列数，整页仍为纵向 ScrollView；统计、阅读活动、设置菜单依次堆叠。
- 同文件中的 `MiniHeatmap` 固定展示 16 周，格子宽度随整块容器宽度增大，7 行格子的总高度也跟着增大，造成大屏下活动区过高。
- `packages/app-expo/src/navigation/TabNavigator.tsx` 在所有尺寸下保留底部导航，大屏适配目前主要调整高度、字号和内边距。
- 书库已有多列网格，聊天已有平板横屏常驻会话栏；应优先复用已有内容与交互。
- 工作区存在上一轮 Android 窗口与阅读器自适应的未提交改动；本计划在其基础上规划，不覆盖这些改动。
- `packages/app-expo/src/screens/ChatScreen.tsx` 已有 `renderSidebarContent()`，但仅 `isTabletLandscape` 时常驻；输入框通过 `useBottomTabBarHeight()` 获取底部避让，导航移至右侧后必须取消这段底栏占高。
- `packages/app-expo/src/screens/NotesView.tsx` 已有书籍分组、笔记/高亮切换、编辑与导出，可将现有列表与内容并排；当前详情采用提前 return，切换布局时不能重挂载编辑器或重复挂载数据加载逻辑。
- `packages/app-expo/src/navigation/RootNavigator.tsx` 中设置页均为根栈独立路由；设置并列需要保留现有路由名称及调用入口，并明确返回与设置分类切换行为。
- `packages/app-expo/assets/reader/reader.template.html` 当前移动排版显式设置 `max-column-count=1`；双页阅读涉及排版约束及页码、定位回归，不能只缩放 WebView。

## Approach

采用 **横屏右侧窄导航、竖屏底栏 + 按页面任务分栏 + 阅读器自动单双页**。用户已确认覆盖四个主页面、阅读器和设置详情，并选择阅读器「自动双页，工具按需展开」。保留现有主题、字体、数据、路由入口和业务能力。

### 1. 共用规则：导航按窗口方向，内容按实际宽度切换

单位：React Native 布局用 dp，WebView 内部排版用 CSS px；不能用截图物理像素决定断点。以下为实施起点，验收时只微调影响可读性和触控的尺寸。

| 层级 | 触发条件 | 结构 |
| --- | --- | --- |
| 主导航 | 当前窗口 `width <= height`（含正方形与 `0 × 0`） | 现有底部四项导航；内容仍按自身实测宽度布局 |
| 主导航 | 当前窗口 `width > height` | 84dp 右侧窄导航，图标配短文字；宽度另加右侧安全区；小于 600dp 的横向窗口也使用右栏 |
| 内容分栏 | 实测可用内容宽度 ≥ 680dp | AI、笔记、设置可显示列表与内容；不足时收起列表 |
| 我的 | 实测可用内容宽度 ≥ 568dp | 概览与设置并排；四项统计在内容宽度 ≥ 560dp 时排成一行 |
| 大统计页 | 实测内容宽度 ≥ 840dp | 图表与排行等按主次并列；较窄窗口顺序排列 |
| 阅读器 | 每页扣除页边距与中缝后，至少有 18em 且不少于 280 CSS px | 横排可重排书籍在翻页模式下允许双页；否则单页 |

- 分栏依据已扣除导航、安全区和页面边距的容器宽度，不重复扣宽，也不依赖「平板」「横屏」标签。普通手机横屏同样按可用空间受益；低高度窗口的控件必须可滚动。
- 延续现有 hook，增加可选容器宽度和明确的宽度派生值；保留原有窗口宽高字段语义。主页面与设置内容通过 `onLayout` 获取自身容器尺寸，阅读器直接使用 renderer 实际尺寸。提取被 hook 真正调用的纯计算供测试，不另造响应式框架。
- 复用已安装 React Navigation bottom-tabs 7.15.5 的 `tabBarPosition` 右/底动态切换能力；侧栏使用 `material` variant 与 `below-icon` 标签组合，底栏恢复原 variant。保持同一个 Tab Navigator 和四个 Screen，不添加随方向改变的 `key`。右栏负责右侧安全区，内容负责左侧安全区；主导航仅属于四个主页面，阅读器和设置详情沿根栈进入。
- 例如安全宽度为 700dp 的横向窗口，扣除 84dp 导航和约 40dp 留白后，仍有约 576dp：可显示紧凑统计及概览/设置双栏，AI 和笔记则保留抽屉/单页结构；840dp 横向窗口再启用列表与内容并排。中等宽度也改善首屏密度。
- 主页面水平留白约 20–28dp，主要触控区域至少 44dp；内容密度来自重排和合理栏宽。AI 消息、设置表单等长文本限制阅读宽度，书库允许更多列。
- 保留现有明暗主题和暖色主题；统一标题、边距与选中态，不另加宣传卡片或新统计指标。

### 2. 逐页设计

| 页面 | 展开态设计 | 窄屏与中等宽度处理 |
| --- | --- | --- |
| 书库 | 顶部标题、搜索、排序、导入成为紧凑工具栏；分组与标签沿用现有筛选。网格按内容宽度增加列数，宽屏封面目标宽度约 128–160dp，上限约 8 列；封面比例、标题与进度保持清晰。批量操作靠近网格，不新增一条占宽的常驻筛选栏。 | 窄屏保留现有三列基线及搜索展开交互；变列时按目标整行实测位置恢复原可见 key，保留筛选和多选。末尾以 key 可见为成功；用户拖动取消恢复。 |
| AI | 左侧 224–280dp 会话列表，右侧对话；消息正文居中并限制约 760dp，输入框与消息同宽。复用已有会话内容和删除、新建交互。 | 内容不足 680dp 时列表回到抽屉；折叠不清空当前对话、草稿或附件。侧导航下输入框仅避让实际底部安全区和键盘，不继续预留底部 Tab 高度。 |
| 笔记 | 左侧 224–280dp 书籍笔记列表，右侧当前书籍的笔记/高亮、搜索与导出；保留当前卡片编辑和跳回原文。没有选择时显示明确的选择提示。 | 回到现有列表→详情路径；选中书籍与编辑草稿由同一 `NotesView` 持有，不能因布局切换重新加载或丢失。阅读器内嵌时只显示当前书籍内容。 |
| 我的 | 四项统计压成紧凑一排，普通字号下高度约 88–104dp；下方左侧约 300dp 起的阅读活动、右侧约 248dp 起的现有设置分组，优先看到常用入口。 | 内容不足 568dp 时概览与设置恢复上下排列；统计可为两列。热力图继续显示 16 周，格子最大约 18dp，7 行高度约 140dp，不随整窗无限放大；保留日期提示和详情入口。大字号允许卡片增高或少排一列。 |
| 设置详情 | 左侧约 208dp 分类，右侧当前设置，表单正文上限约 720dp。覆盖外观、字体、AI、听书、翻译、同步、向量模型、关于与反馈；页面内部按真实内容组织，同步状态/表单、AI 端点列表/编辑器可利用剩余宽度。 | 分类放不下时使用现有独立页面与返回按钮；旋转只隐藏分类，当前页面与未保存输入保持。保持原页面的保存、测试连接、失败反馈与危险操作确认。 |
| 阅读统计/成就/Skills | 复用统计页现有分区与主次比例，限制图表高度约 160–240dp；成就和 Skills 按最小卡宽增加列数，短卡片不横向拉满。 | 宽度不足时按现有顺序单列；时间范围、选择和滚动状态保持。 |
| 书籍详情 | 封面、标题、进度等概览在左侧约 220–260dp，信息/简介/书评在右侧；沿用现有行内编辑和保存行为。 | 内容不足 680dp 时回到现有顺序；编辑浮层和日期选择限制宽度，键盘不遮挡提交。 |
| 书籍 AI、全屏笔记、WebDAV 导入 | 书籍 AI 限制消息行宽、输入与正文对齐；全屏笔记复用笔记内容；WebDAV 保留路径与选择列表，紧凑安排连接状态、返回和导入操作。 | 不为这些独立流程强行增加全局导航；保留书籍、CFI、远端路径和已有返回入口。 |

「我的」布局：

```text
┌───────────────────────────────────────────┬──────┐
│ 我的                                 同步 │ 书库 │
├───────────────────────────────────────────┤ AI   │
│ 总时长    阅读字数    已读    连续阅读     │ 笔记 │
├─────────────────────┬─────────────────────┤ 我的 │
│ 阅读活动   查看详情 │ 外观、字体          │      │
│ 紧凑的 16 周热力图  │ AI、听书、翻译      │      │
│                     │ 同步、其他现有设置  │      │
└─────────────────────┴─────────────────────┴──────┘
```

### 3. 阅读器：把展开态变成可阅读的书页

```text
空间足够：     [        左页        │        右页        ]
打开辅助区：   [       正文，单双页按剩余宽度       ][目录/笔记/搜索]
窄屏：         [                 单页                   ] + 按需浮层
```

- 默认使用已有 `paginatedLayout: "double"` 偏好表达「宽度足够时双页」，`"single"` 表达「始终单页」；阅读设置提供这两个选择。保持现有共享类型和桌面同步含义，不新增 `auto` 枚举，也不因缩窗写回用户偏好。
- 横排可重排书籍使用 foliate 已有双列能力，复用桌面阅读器的双页边距/中缝推导；每页按实际字号和可用宽度判断，不通过整体缩放字体凑成双页。分页单栏限制合理行宽并居中。
- 目录/书签、笔记、搜索复用同一个右侧辅助位置，宽约 280–320dp，一次显示一种内容。正文至少保留约 360dp 才常驻；不足时辅助区回到抽屉/浮层。打开辅助区后用正文剩余宽度重新判断单双页。
- `ReaderTOCPanel` 提取可内嵌的内容，窄屏继续使用现有弹层；笔记复用 `NotesView` 的当前书籍模式，并提供定位当前 Reader 的回调，避免点击笔记再次打开一层阅读器。目录定位和笔记跳转在宽屏不关闭辅助区，便于连续查看。
- `ReaderAuxiliaryPanel | null` 是唯一互斥状态，`ReaderAuxiliaryPane` 保持三个槽的父树稳定，只改变 display／位置／尺寸；打开中的 `NotesView` 不因 dock 切换重挂载。`closeSearch()` 统一结束搜索会话；搜索 X 保留返回原位置确认，硬件返回直接关闭。
- 搜索辅助区展示可点击的匹配摘录。当前 WebView 仅回传数量与索引，需从已有搜索结果增加最小的 CFI/摘录回传，桥接、搜索 hook 与面板一起完成；用查询代次同时隔离 WebView 搜索任务和 RN 回传，清空或换书时作废旧结果，避免迟到结果覆盖列表或跳转旧位置。保留前后结果跳转与返回搜索前位置。
- 阅读设置用限宽面板；工具栏在正文范围内排列，进度条和按钮不跨越辅助区。选择菜单、笔记提示、翻译面板的坐标与宽度跟随新的 WebView 容器。
- 保持滚动模式单栏及其流式约束；竖排书籍沿用当前兼容处理。固定排版书籍沿用既有 spread/zoom 规则，不套横排文本公式。
- 重排通过现有 ResizeObserver/rAF 路径完成，继续使用代数标记隔离旧回调；尺寸缓存须同时考虑单双页、字号和边距变化。WebView 与书籍实例保持，不重新开书；用 CFI 保持阅读锚点，允许实际页数随排版变化。

### 4. 设置导航、听书与连续操作

- 在根栈为设置路由组增加稳定的 `SettingsLayout`，通过已安装 React Navigation 的 `screenLayout` 包裹原 Screen；不同宽度下保持相同组件树，分类区域只改变显示与尺寸。保留所有 `RootStackParamList` 路由名，聊天等已有设置入口可继续直达。
- 分类选择替换当前同级设置路由，避免按多个分类累积返回历史；返回恢复进入设置前的主页面或书籍 AI。反馈详情返回反馈列表，并保持反馈分类选中。复用已有保存机制；同步表单等存在未保存修改时，分类切换提供保存/放弃/取消，保存失败留在当前页。
- `settings-leave.ts` 是唯一保存／放弃／取消提示，`use-settings-leave-guard.ts` 同时服务导航离开和同步后端切换。询问与保存共用一个生命周期锁，dismiss 不抢先结束保存；获准后原样重派发 `data.action`，卸载后不再执行目标切换。
- 设置分类只复用现有入口。新增小型共享入口定义供「我的」与分类栏共用，保留通知红点；清缓存等即时操作继续按原行为执行，不伪装成详情页。
- 听书展开态采用左侧书籍信息/播放控制、右侧歌词；适配当前可用高度，低窗口沿用可滚动方案。播放状态、队列、当前句和定位复用现有 TTS store 与回调，不因布局切换重启播放。
- 听书浮球及迷你播放器继续可拖动、可关闭，边界避让实际导航与安全区；主 Tab 横屏时仅在右侧保留 84dp，竖屏时避让底栏，Reader 上不保留主导航宽度。旋转沿用现有气泡约束 effect 和播放器当前窗口边界计算；`navigationInsets` 使用必填 `right`、`bottom` 字段。声音选择、计时、标签管理与导入弹层使用有限宽度并允许短窗口滚动。
- 关闭播放器时浮球拖动仅更新 Animated；打开后以单个 rAF 合并测量，几何 token 拒绝旋转前或关闭后的迟到结果。`TTSBubbleAnchor` 只持有 left／top／size；播放器使用当前窗口与必填导航避让计算边界。

## Files to modify

以下为批准的实施范围。已存在的窗口适配改动采用增量修改，不覆盖；各项实际结果见 [验收记录](./foldable-large-screen-verification.md)。

| 目的 | 关键文件 |
| --- | --- |
| 宽度计算与主导航 | `packages/app-expo/src/hooks/use-responsive-layout.ts`；`packages/app-expo/src/navigation/TabNavigator.tsx` |
| 设置路由与共用分类 | `packages/app-expo/src/navigation/RootNavigator.tsx`；`packages/app-expo/src/screens/settings/SettingsLayout.tsx`、`settings-navigation.ts`、`settings-icons.ts`、`settings-leave.ts`、`use-settings-leave-guard.ts`、`SettingsHeader.tsx` |
| 书库与我的 | `packages/app-expo/src/screens/LibraryScreen.tsx`；`packages/app-expo/src/screens/library/LibraryGrid.tsx`、`library-grid-anchor.ts`；`packages/app-expo/src/screens/ProfileScreen.tsx` |
| AI | `packages/app-expo/src/screens/ChatScreen.tsx`；`packages/app-expo/src/screens/BookChatScreen.tsx`；必要的消息/输入宽度调整在现有 `packages/app-expo/src/components/chat/MessageList.tsx`、`packages/app-expo/src/components/chat/ChatInput.tsx` |
| 笔记 | `packages/app-expo/src/screens/NotesView.tsx`；`packages/app-expo/src/screens/notes/notes-styles.ts`；核对 `packages/app-expo/src/screens/NotesScreen.tsx`、`packages/app-expo/src/screens/FullScreenNotesScreen.tsx` 的参数与返回行为 |
| 设置内容与表单 | `packages/app-expo/src/screens/settings/AppearanceSettingsScreen.tsx`、`packages/app-expo/src/screens/settings/FontSettingsScreen.tsx`、`packages/app-expo/src/screens/settings/AISettingsScreen.tsx`、`packages/app-expo/src/screens/settings/TTSSettingsScreen.tsx`、`packages/app-expo/src/screens/settings/TranslationSettingsScreen.tsx`、`packages/app-expo/src/screens/settings/SyncSettingsScreen.tsx`、`packages/app-expo/src/screens/settings/VectorModelSettingsScreen.tsx`、`packages/app-expo/src/screens/settings/AboutScreen.tsx`、`packages/app-expo/src/screens/settings/FeedbackScreen.tsx`、`packages/app-expo/src/screens/settings/FeedbackDetailScreen.tsx`；相邻已有 AI/sync 样式及表单仅作布局和草稿保护调整 |
| 其他根栈页面 | `packages/app-expo/src/screens/StatsScreen.tsx`、`packages/app-expo/src/screens/stats/stats-styles.ts`、`packages/app-expo/src/screens/BadgesScreen.tsx`、`packages/app-expo/src/screens/SkillsScreen.tsx`、`packages/app-expo/src/screens/BookDetailsScreen.tsx`、`packages/app-expo/src/screens/library/WebDavImportBrowserScreen.tsx` |
| 阅读容器与侧区 | `packages/app-expo/src/screens/ReaderScreen.tsx`、`packages/app-expo/src/screens/reader/ReaderAuxiliaryPane.tsx`、`ReaderTOCPanel.tsx`、`ReaderSettingsPanel.tsx`、`ReaderSearchPanel.tsx`；`packages/app-expo/src/screens/reader/styles/reader-base-styles.ts`、`reader-sheet-styles.ts`，保持 `reader-styles.ts` 聚合入口 |
| 阅读排版与搜索桥接 | `packages/app-expo/assets/reader/reader.template.html`、构建生成的 `packages/app-expo/assets/reader/reader.html`、`packages/app-expo/src/hooks/use-reader-bridge.ts`、`packages/app-expo/src/screens/reader/useReaderSearch.ts` |
| 依附阅读区域的控件 | `packages/app-expo/src/components/reader/SelectionPopover.tsx`、`packages/app-expo/src/screens/reader/ReaderNoteViewModal.tsx`、`packages/app-expo/src/screens/reader/styles/reader-note-styles.ts`、`packages/app-expo/src/components/reader/TranslationPanel.tsx`、`packages/app-expo/src/components/reader/ChapterTranslationSheet.tsx`；仅修复新容器造成的位置/宽度问题 |
| 听书及弹层 | `packages/app-expo/src/components/reader/TTSPage.tsx`、`packages/app-expo/src/components/reader/tts/tts-page-styles.ts`、`packages/app-expo/src/components/reader/tts/VoicePickerModal.tsx`、`packages/app-expo/src/components/tts/FloatingTTSBubble.tsx`、`packages/app-expo/src/components/tts/TTSMiniPlayer.tsx`、`packages/app-expo/src/components/tts/TTSSleepTimerSheet.tsx`；必要的全局浮层布局传递位于 `packages/app-expo/src/App.tsx` |
| 书库弹层 | `packages/app-expo/src/screens/library/TagManagementSheet.tsx`、`packages/app-expo/src/screens/library/WebDavImportSourceSheet.tsx`、`packages/app-expo/src/screens/library/WebDavConnectSheet.tsx` |
| 新文案 | `packages/core/src/i18n/locales/*/reader.json` 和确有新增键的对应 `settings.json`/`common.json`；复用已有 Tab、分类与按钮翻译，支持的语言均补齐新增键 |
| 回归 | `packages/app-expo/src/screens/reader/adaptive-window.test.ts`；`packages/app-expo/src/hooks/use-responsive-layout.test.ts`；`packages/app-expo/src/screens/library/library-grid-anchor.test.ts` 测真实恢复 controller；`packages/app-expo/src/screens/settings/settings-navigation.test.ts` 测路由、`settings-leave.test.ts` 测真实 Alert 异步决策；既有章节页码测试保留并运行 |

不新增依赖，不改数据库、同步数据格式、Android 窗口插件或桌面页面；复用桌面排版公式时不改桌面实现。

## Reuse

- `packages/app-expo/src/hooks/use-responsive-layout.ts`：窗口尺寸订阅；全部现有调用者需核对窗口宽度与容器宽度含义。
- `packages/app-expo/src/navigation/TabNavigator.tsx`：现有四个 Tab、图标、国际化和导航状态；已安装的 bottom-tabs 7.15.5 支持动态右侧/底部导航，参见[官方文档](https://reactnavigation.org/docs/bottom-tab-navigator)。
- `packages/app-expo/src/screens/ProfileScreen.tsx`：`overviewCards`、`StatCard`、`MiniHeatmap`、`menuSections`；`packages/app-expo/src/lib/stats/live-reading-stats.ts` 的实时阅读统计逻辑及反馈红点继续使用。
- `packages/app-expo/src/screens/ChatScreen.tsx`：`renderSidebarContent()`；`packages/app-expo/src/components/chat/ThreadList.tsx`、`packages/app-expo/src/components/chat/MessageList.tsx`、`packages/app-expo/src/components/chat/ChatInput.tsx`：会话、消息、输入与流式输出。
- `packages/app-expo/src/screens/NotesView.tsx` 与 `packages/app-expo/src/screens/notes/`：已有书籍分组、搜索、编辑、导出、定位及封面解析；不复制一套阅读器笔记业务。
- `packages/app-expo/src/screens/settings/SettingsHeader.tsx`：原返回与 fallback；各设置页现有表单及保存逻辑。
- `packages/app-expo/src/screens/StatsScreen.tsx` 与 `packages/app-expo/src/screens/stats/`：现有图表、排行、日历、目标与成就，无新增假数据。
- `packages/app/src/components/reader/FoliateViewer.tsx` 的 `applyRendererSettings()`/`applyReflowLayoutSettings()`：双页 gap 与栏宽推导；`packages/foliate-js/paginator.js` 已有双列渲染，无需新分页引擎。
- `packages/app-expo/assets/reader/reader.template.html`：现有 resize 隔离、CFI、搜索与固定排版流程；`packages/app-expo/src/hooks/use-reader-bridge.ts` 和 `packages/app-expo/src/screens/reader/useReaderSearch.ts` 保留现有调用入口。
- `packages/app-expo/src/components/reader/TTSPage.tsx`、`packages/app-expo/src/components/tts/FloatingTTSBubble.tsx`：现有句子定位、播放回调、拖动和缩窗边界处理。
- `packages/app-expo/src/styles/theme.ts`、`packages/app-expo/src/styles/ThemeContext.tsx`：颜色、字号、边距和主题令牌。

## Steps

规划完成：

- [x] 阅读截图及全部主要页面、设置导航、阅读桥接与听书布局，记录可复用能力及实际缺口。
- [x] 确认全应用范围、横屏 84dp 右侧窄导航与竖屏底栏、阅读器自动双页与按需辅助区。
- [x] 给出导航按当前窗口方向、内容按实际宽度的切换规则、逐页布局、状态保持与返回行为。
- [x] 列出修改范围、组件复用与验收方法。

批准后实施，按以下顺序完成同一方案：

- [x] 先完成共用宽度计算、导航右/底切换及键盘/安全区适配，保护已有导航实例。
- [x] 重排书库、AI、笔记、我的；验证折叠切换的草稿、选择与滚动锚点保持。
- [x] 接入设置分类布局和原路由，完善分类切换的保存保护，再处理统计、书籍详情及导入等附属页。
- [x] 完成阅读器单双页、辅助面板、搜索结果回传和工具坐标；同步构建 reader.html。
- [x] 完成听书分栏及所有受影响浮层的尺寸/边界，补充必要新文案与回归。
- [ ] 运行范围内检查，进行真实渲染与交互验收，交付逐页截图和剩余设备验收项。

## Verification

以下为批准的完整验收要求。当前自动检查、构建及阅读器浏览器验收结果已记录在 [验收记录](./foldable-large-screen-verification.md)；原生设备检查仍未完成。

- **尺寸矩阵**：用约 390×844、600×700、700×700、840×600、960×720、1280×800dp，以及 840×390dp 低高度窗口检查；补测 1024×768→768×1024→1024×768 的右栏/底栏旋转、599×390 的窄横屏右栏和 840×840 的正方形底栏。以真机报告的逻辑尺寸补充截图设备，不将这组样本当作所有设备的尺寸。
- **导航与状态**：四个 Tab 往返；每页连续展开→旋转→分屏→折叠；AI 正在输出、草稿/附件未发送，笔记正在编辑，多选书籍和滚动到中段，均继续可用。分类切换后返回原入口，未保存同步表单能够取消跳转或保存后离开；反馈详情正确返回列表。
- **首屏与密度**：「我的」在可分栏宽度下同时显示四项统计、完整紧凑热力图及常用设置入口；书库封面可辨认；AI/笔记列表与内容无挤压；空数据、长标题、大量书籍和长会话均使用真实既有能力。
- **阅读关键路径**：使用真实可重排 EPUB 逐页/跨章/跳页、书签、搜索、高亮/笔记和返回原文；双页↔单页及开关辅助区后保持同一 CFI 文本锚点；页码按新排版更新，章节页码契约继续通过。验证大字号、滚动、竖排、固定排版及听书高亮，不只检查 renderer 属性。
- **搜索回归**：新查询替代旧查询、清空、无结果、点击摘录定位与关闭后返回原位置；使用真实搜索/桥接处理路径，验证迟到结果不会更新当前列表。
- **触控与主题**：明暗主题、中文/英文、系统字号 1.0 与 1.5 倍；主要按钮触控至少 44dp，热力图另提供可聚焦的日期读数和详情入口，主操作不会仅靠悬停。检查 TalkBack 标签、选中状态、键盘遮挡、手势/三键导航安全区、浮球拖拽和迷你播放器锚点。
- **自动检查**：用已有 Vitest 运行新增宽度/设置导航用例及 `src/screens/reader/adaptive-window.test.ts`、`src/screens/reader/chapter-page-numbering-contract.test.ts`；阅读器回归执行真实模板逻辑并扩充模式/字号缓存场景，不复制公式自证。通过 `pnpm --filter @readany/app-expo build:reader` 生成产物；在 app-expo 包内对改动文件运行 Biome、类型检查并区分既有错误。
- **实际渲染**：实施后须提供主页面、设置、阅读器、听书的展开/窄屏截图，实际点按核心流程。Expo Go 对本项目原生模块不足以代表真实运行，应使用已有 development build；Web 预览可辅助看布局，Android WebView 与折叠切换由目标设备验收。本机已知缺 Android SDK/可用设备，若届时仍无运行目标，不安装系统 SDK、不走 EAS，将该项明确列为待设备验收。

当前交付包含源码改动、生成的 reader.html、自动回归、阅读器的 13 个浏览器场景截图及设备验收清单。主页面、设置与听书的原生运行截图尚缺，步骤 10 保持未完成。省略新业务模块、桌面改版和新增依赖。
