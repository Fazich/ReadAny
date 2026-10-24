# 阔折叠大屏设计：实现与验收记录

全应用布局改动已写入工作区；此前的大屏布局已完成本机自动检查、阅读器浏览器验收和 Android APK 构建。本次严格质量审查的四项实现、60 项自动回归、TypeScript 检查和最终 Android JavaScript 导出已完成，详见实施增量。**原生设备交互及截图仍未完成。** 当前在线 Android 折叠设备的 development 安装被 `INSTALL_FAILED_USER_RESTRICTED` 拒绝；此前「无在线设备」是历史记录。

## 可安装 APK

当前 release 包包含本次横屏右栏、竖屏底栏与听书浮层调整：

| 项目 | 值 |
| --- | --- |
| 文件 | `~/Downloads/readany-1.3.7-arm64-production-2026-10-24.apk`（85.6MB） |
| 构建产物 | `packages/app-expo/android/app/build/outputs/apk/release/app-release.apk` |
| 包名 / 名称 | `com.readany.app` / ReadAny 1.3.7（production 变体） |
| 架构 | 仅 `arm64-v8a`；targetSdk 36 |
| 签名 | 本地 debug keystore |
| SHA-256 | `8f4dccdd1c1a9c8a0fcba0366278932e099f426dd08bb808385b56d2ef9091df` |
| 构建命令 | `JAVA_HOME=<temurin-21> APP_VARIANT=production ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`（sdk.dir 指向 `/opt/homebrew/share/android-commandlinetools`；Gradle 8.14.3，47 秒完成） |
| JS 一致性 | APK 内 `assets/index.android.bundle` 与 Gradle 生成的 bundle SHA-256 相同（`15d9eb25…5827`），bundle 生成时间晚于全部源码修改 |

此前的大屏布局版本仍为 `~/Downloads/readany-1.3.7-arm64-production.apk`（SHA-256 `ed3f0766…96c0`），不包含本次导航调整，仅留作对照。

安装注意：debug 签名与商店/EAS 正式包不兼容，设备上若已装其他签名的 `com.readany.app` 需先卸载；仅支持 arm64 设备。`android/` 是 gitignored 的 prebuild 产物，本次未改动原生配置，插件产出的 `screenOrientation=unspecified`、`resizeableActivity=true` 已在 APK manifest 中确认（另一个 portrait 项属条码扫描 activity，不是主界面）。

对应方案：[foldable-large-screen-design.md](./foldable-large-screen-design.md)。

## 已实现的布局

| 页面/区域 | 当前实现 | 验收证据 |
| --- | --- | --- |
| 共用布局与主导航 | 当前窗口 `width > height` 时使用 84dp 右侧导航，否则使用底栏；右栏宽度另加右侧安全区，内容保留左侧安全区；保持同一个 Navigator 与四个 Screen | 方向及原有内容布局回归通过；实际导航旋转待设备 |
| 书库 | 按内容宽度调整网格列数，保存可见书籍锚点及筛选、多选状态 | 类型检查通过；网格切换、滚动恢复待设备 |
| AI 与书籍 AI | 常驻会话列表按内容宽度启用；消息与输入框限宽，右侧导航下取消底部 Tab 占位 | 类型检查通过；键盘、流式输出和未发送草稿待设备 |
| 笔记 | 书籍列表与当前内容并排；窄屏继续列表→详情；同一内容区域承载编辑，阅读器内支持跳回当前正文 | 类型检查通过；编辑中折叠、跳转和导出待设备 |
| 我的 | 紧凑统计、概览与设置分栏；16 周热力图格子限宽，不再随窗口无限长高 | 宽度与大字号计算回归通过；首屏密度和日期触控待设备 |
| 设置 | 原路由外包稳定分类布局；分类切换不累积历史；同步表单保存/放弃/取消，并保护晚到配置和保存中的新输入 | 路由与离开决策回归通过；系统返回、原生确认框和表单输入待设备 |
| 附属页 | 统计按内容宽度分栏，成就/Skills 调整密度，书籍详情概览与信息并排，WebDAV 页面与弹层限宽 | 类型检查通过；实际图表、长内容和导入操作待设备 |
| 阅读器 | 足够宽时双页，大字号/窄窗自动单页；目录、笔记、搜索共用辅助区；搜索回传 CFI 与摘录并隔离过期任务；工具坐标使用正文容器 | 真实 `reader.html` 的排版、定位与搜索已验证；RN 辅助区与 Android WebView 待设备 |
| 听书与浮层 | 播放信息/控制与歌词分栏；声音、计时、标签和导入弹层限宽及短窗滚动；浮球/播放器避让当前右栏或底栏，Reader 上取消主导航宽度保留 | 类型检查及 Android bundle 通过；浮层边界、播放连续性、拖动和原生 Modal 待设备 |

未改变桌面页面、数据库或同步数据格式，没有新增依赖。既有 Android 窗口插件及配置改动保留在工作区，本次布局工作未扩展其职责。

## 严格质量审查：实施增量

- 书库恢复已迁入 `library/LibraryGrid.tsx` 与 `library-grid-anchor.ts`。只按目标整行实测 y 完成恢复；未测时使用行索引及失败接近机制，保留 captured key，直到实际定位后确认可见。旧 token、删除／过滤和拖动均可取消；未改变列数和卡片几何。
- 本次 `vitest run src/screens/library/library-grid-anchor.test.ts`：13 项通过，覆盖可变行高、5／6／8 列、连续 3→5→3、过期回调、内容增长 clamp 后重试及同步可见回调。直接导入真实模块的 smoke 输出 `row30 → offset6000 → 实测6194`，确认 key 可见后内容变更不再滚动。TypeScript LSP 对书库新模块无诊断。
- 阅读辅助区改为单一 `ReaderAuxiliaryPanel | null` 状态与稳定 `ReaderAuxiliaryPane` 三槽。真实组件／搜索 hook 的 React 浏览器 smoke 验证宽→窄→宽保留同一编辑节点及草稿、窄屏目录遮罩、搜索无该遮罩、旧 query 隔离、清空输入保留原 CFI、关闭及换书清除会话。原生边界使用临时 DOM adapter，未将该结果视作 Android UI 验收。现有 `adaptive-window.test.ts` 15 项通过。
- 设置提示与导航保护分离：`settings-leave.ts` 是唯一三按钮 Alert，分类离开和后端切换共用一个锁。实际 helper 与路由测试共 9 项通过；真实 hook 生命周期 smoke 验证取消／保存异步时序、重复触发不叠框、clean 重渲染仍受保存锁保护、原 action 对象重派发及卸载后不切后端。RN 0.81 的 Promise fallback 无 `withResolvers`，helper 保留兼容的 Promise 构造形式。
- 浮球移除 `pan.addListener`，共享 `TTSBubbleAnchor` 只含 left／top／size。真实 FloatingTTSBubble 的受控 React smoke 记录关闭时 30 次双轴移动：measure=0、listener=0、子树重渲染=0；打开后同帧多次请求合并为一次测量，同坐标保持 anchor 对象且子树不重渲染。旋转／关闭／inactive／卸载均拒绝旧 callback 并取消待执行帧。动画、native measure、store 和 MiniPlayer 边界使用临时适配器，真实播放／原生位置仍未验证。
- 最终自动检查：`pnpm --filter @readany/app-expo exec vitest run` 为 12 个文件、60 项通过；`pnpm --filter @readany/app-expo exec tsc --noEmit` 退出码 0、无诊断。最终 Android development JS 导出成功，Metro 编译 5,278 个模块（29.6MB）；临时 React smoke、DOM／动画适配器、服务及导出工件已清理。
- 原生准备：在线型号 `2608BPX34C`，内屏系统配置 `608×860dp`（440dpi）；prebuild 后 applicationId 已读取为 `com.readany.app.dev`。生产包未卸载／清库。240 本 `quality-review-001…240` EPUB 通过现有 ZIP builder 生成并传至独立 Download 目录，尚未经 UI 导入。
- 原生交互受设备权限限制：`adb shell input keyevent KEYCODE_WAKEUP` 抛出 `INJECT_EVENTS` SecurityException。初次编译的 production BuildConfig 旧 autolinking 缓存已重新生成，development Gradle 构建成功；安装返回 `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`。当前无法启动 development app，书库变列、Reader 原生实例、设置原生 Alert 与播放器截图均未验证。
- 独立 development 原生壳：`packages/app-expo/android/app/build/outputs/apk/debug/app-debug.apk`，产物 metadata 的 applicationId 为 `com.readany.app.dev`；SHA-256 为 `9fd8704bbe0e9ce2ee70adb5a09f1e33967a5c1dbf130dbec64d85eb914c4a32`。该 debug APK 启动需 Metro；它不是内嵌本次 JS 的独立 release 包。没有安装或改写 production 包。

## 本次方向导航调整：增量验收

导航严格使用窗口 `width > height`，不受 600dp、安全宽度、平板标签或实测内容宽度影响。气泡的左边界回到左侧安全区，右边界扣除可见右栏；迷你播放器仅使用 `navigationInsets.right` 和 `bottom`，旋转继续沿用当前窗口约束。旧的 `TTS floating UI window bounds` 源码提取测试已删除，原生窗口插件及阅读模板测试保留。

- 修改规则前，新行为用例复现三项旧规则错误：768×1024 与 840×840 错用侧栏，599×390 错用底栏。
- 修改后，`pnpm --filter @readany/app-expo exec vitest run src/hooks/use-responsive-layout.test.ts`：5 项通过，覆盖批准的七组方向输入以及原有内容布局和安全区计算。
- `pnpm --filter @readany/app-expo exec vitest run src/hooks/use-responsive-layout.test.ts src/screens/reader/adaptive-window.test.ts`：2 个文件、20 项通过。
- `pnpm --filter @readany/app-expo exec tsc --noEmit`：通过。
- 实际布局模块的旋转 smoke：1024×768→768×1024→1024×768 输出右栏→底栏→右栏；599×390 输出右栏，840×840 输出底栏；各次传入的 400dp 内容宽度保持不变。
- 使用 `APP_VARIANT=development EXPO_OFFLINE=1 CI=1 pnpm --filter @readany/app-expo exec expo export --platform android --dev --no-bytecode --no-minify --max-workers 2 --output-dir <临时目录>` 成功导出 Android development JavaScript bundle，Metro 编译 5,272 个模块。此项验证模块集成与打包；原生界面交互仍待设备。

此前方向导航验收时：`adb devices -l` 仅返回设备列表标题，无在线目标。`android/local.properties` 指向 `/opt/homebrew/share/android-commandlinetools`，该 SDK 未安装 emulator；PATH 中无 emulator，默认 `~/.android/avd` 不存在。未安装新的系统镜像或模拟器。当前设备及安装限制见上方严格质量审查记录。

设备型号、实际 RN 窗口尺寸、当前 Tab、草稿及播放状态均因无运行目标而未采集。以下验收仍待具备 development build 的可旋转 Android 设备：

- 四个 Tab 点击、AI 草稿/会话与键盘占位、书架滚动位置，以及窄横屏和正方形窗口动态切换。
- 真实 EPUB 播放时气泡两侧拖动、迷你播放器边界及操作、旋转播放连续性、不对称安全区，以及 Tabs↔Reader 的 84dp 保留区切换。
- 三张实际设备截图：横屏右栏、旋转后竖屏底栏、打开迷你播放器的横屏右栏。当前未生成原生截图。

## 此前大屏改动的自动检查

- `pnpm --filter @readany/app-expo exec vitest run`：10 个测试文件、47 项测试通过。包含窗口计算、设置路由/离开决策、章节页码契约、真实模板单双页与搜索代次、旧 ResizeObserver/rAF 隔离、文本锚点及浮层边界。
- `pnpm --filter @readany/app-expo exec tsc --noEmit`：通过。
- `pnpm --filter @readany/app-expo build:reader`：成功生成已跟踪的 `packages/app-expo/assets/reader/reader.html`，约 2084KB。
- `git diff --check`：通过。
- 对改动的 TypeScript/TSX/JSON 使用 Biome 检查，并关闭格式化和 import 排序。`ReaderScreen.tsx` 仍有 40 项错误、5 项警告，主要为原有 effect 依赖、未使用变量和 `any`；`BadgesScreen.tsx` 仍有 2 项错误、4 项警告，涉及原有数组索引 key、动画 effect 依赖和未使用代码。与 `HEAD` 同参数基线对照，相关问题原已存在；其余 63 个文件无诊断。本次没有扩大范围重构这些既有逻辑。

## 真实阅读产物：13 个浏览器场景

使用本机 Chrome，通过 loopback HTTP 打开**实际构建的 `reader.html`**，经现有 `message` 命令入口加载生成的三章 EPUB（横排、竖排源、固定排版）。没有替换分页/搜索实现，没有读取用户书籍，外网请求为 0。截图采用暖色浅色主题、18px 正文字号及 16px 页边距；大字号场景为 32px。

机器记录：[reader-browser-report.json](./artifacts/foldable-large-screen/reader-browser-report.json)。13 个场景通过，脚本运行期间没有页面异常或阅读桥接错误。

| 场景 | 结果 | 截图 |
| --- | --- | --- |
| 960×720 初始展开 | 双页，页栏约 430px | [初始双页](./artifacts/foldable-large-screen/reader-960-double.png) |
| 640×720、520×720 | 自动单页，原文本锚点可见 | [640](./artifacts/foldable-large-screen/reader-640x720.png)、[520](./artifacts/foldable-large-screen/reader-520x720.png) |
| 390×844 | 单页，原文本锚点可见 | [窄屏](./artifacts/foldable-large-screen/reader-390x844.png) |
| 840×390 | 短横屏双页，原文本锚点可见 | [短横屏](./artifacts/foldable-large-screen/reader-840x390.png) |
| 1280×800 | 双页，原文本锚点可见 | [更宽窗口](./artifacts/foldable-large-screen/reader-1280x800.png) |
| 回到 960×720 | 双页，原文本锚点仍可见，未重新开书 | [缩放循环后](./artifacts/foldable-large-screen/reader-960x720.png) |
| 960×720、32px 字号 | 每页宽度不足时自动单页，原文仍可见 | [大字号](./artifacts/foldable-large-screen/reader-960-large-font.png) |
| 手动选择单页 | 正文单栏、限制行宽并居中，原文仍可见 | [手动单页](./artifacts/foldable-large-screen/reader-960-forced-single.png) |
| 搜索后定位 | 回传 210 项匹配及 CFI/章节/摘录；点击结果后对应原文可见，再缩窗仍保持该新位置 | [搜索定位](./artifacts/foldable-large-screen/reader-960-search.png) |
| 滚动模式 | 单栏流式排版 | [滚动](./artifacts/foldable-large-screen/reader-960-scroll.png) |
| 竖排源 EPUB | 沿用现有兼容规则，计算样式为 `horizontal-tb`，足够宽时双页；本项不表示保留竖排书写方向 | [竖排源兼容](./artifacts/foldable-large-screen/reader-960-vertical-source.png) |
| 固定排版 EPUB | 使用既有固定排版 spread/zoom，不套文本列宽公式 | [固定排版](./artifacts/foldable-large-screen/reader-960-fixed.png) |

还实际执行了下一页→上一页、跨章→CFI 返回、按进度定位、无结果搜索。连续尺寸切换顺序为 `960 → 640 → 520 → 390 → 840 → 1280 → 960`，同时断言仍为同一个 `foliate-view` 且只开书一次。

浏览器验收发现并修复了一处重排问题：分页引擎会将重排后的页首写成后续重排锚点，连续缩窗就逐次前移。模板现在保留折叠后的文本 `Range`，忽略重排及其派生滚动产生的锚点更新，在真正翻页/跳转时更新；停止或换书时移除旧订阅。新增回归覆盖连续缩窗、字号变化、真实翻页后的锚点替换和停止后不再恢复。验收判断是原文本仍在当前可见页内，页码和该页的首尾 CFI 随重排正常变化。

### 已检查的渲染示例

960×720 双页：

![960×720 双页](./artifacts/foldable-large-screen/reader-960-double.png)

390×844 单页：

![390×844 单页](./artifacts/foldable-large-screen/reader-390x844.png)

840×390 短横屏：

![840×390 短横屏](./artifacts/foldable-large-screen/reader-840x390.png)

## 设备验收：第 10 步的剩余工作

执行人：具有目标设备和包含本次改动的 development build 的验收者。恢复条件：可安装、启动该 build，并在折叠/展开、旋转、分屏及软键盘显示时操作。Expo Go 不能代表本项目全部原生模块；本机浏览器截图仅覆盖阅读内容，不包含 RN 导航、辅助面板或听书界面。

| 页面/流程 | 操作和通过条件 | 尚需截图 |
| --- | --- | --- |
| 书库 | 滚动到中段并筛选、多选，展开/缩窗后选择和可见书籍保持；左右导航切换不重置页面 | 展开、窄屏 |
| AI | 输入未发送草稿/附件并启动流式输出，切换尺寸和键盘；消息/输入对齐，底部不残留 Tab 占位 | 会话分栏、窄屏键盘 |
| 笔记 | 编辑未保存笔记时折叠/旋转；草稿、选中书籍、搜索保留，跳回原文正确 | 书籍列表/笔记并排、窄屏编辑 |
| 我的 | 展开后首屏同时呈现紧凑统计、16 周热力图及常用设置；日期读数可操作；1.5 倍系统字号不裁切 | 展开、窄屏、大字号 |
| 设置 | 从主页面或书籍 AI 进入，切换分类后返回原入口；修改同步表单分别取消/放弃/保存，失败或保存期间继续输入不丢失；反馈详情返回列表 | 分类与表单、窄屏、未保存确认 |
| 阅读器 | 在 Android WebView 中重复尺寸循环；目录/笔记/搜索辅助区开关后保留原文，点击笔记不再开一层 Reader；高亮、选择菜单、翻译与进度工具不跨辅助区 | 双页、辅助区、窄屏、选择/翻译 |
| 听书 | 播放中切换展开/窄屏，当前句/队列/播放继续；歌词与控制区可滚动；声音/计时弹层在短窗有可达关闭入口 | 歌词分栏、窄屏、短窗弹层 |
| 全局浮层 | 主页面/Reader 间跳转、切换侧/底导航，拖动浮球和迷你播放器后缩窗；都位于可视区内且不挡系统导航 | 右侧导航、底栏、短窗 |
| 附属页 | 统计/成就/Skills/书籍详情/WebDAV 长内容、行内编辑、分享和导入操作可用 | 对应展开态 |

上述流程还需检查明暗主题、中英文、系统字号 1.0/1.5、TalkBack、手势/三键导航及实际键盘避让。完成后将截图加入本目录，并更新计划第 10 步；当前不将这些项目记为通过。
