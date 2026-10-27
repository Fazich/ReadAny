# 折叠屏横屏阅读与 AI 可调分栏

## Context

用户希望在折叠屏横屏阅读时，点击 AI 后仍能看到书籍：左侧阅读、右侧 AI，支持像 PC 一样拖动分隔线调节宽度。截图显示当前为 Android 大屏双页阅读。

## Approach

### 用户已确认的交互

- 宽度足够的横屏窗口启用左书右 AI，适用于折叠屏、平板；竖屏或窄窗口显示全屏 AI。
- AI 打开后旋转、折叠或缩小窗口时，自动切为全屏 AI；恢复宽屏横屏时回到分栏。当前会话、流式回答、未发送草稿及附带选区保持。
- 右栏有关闭按钮；关闭或 Android 返回后回到阅读，再点 AI 可继续当前阅读页中保留的草稿。离开当前书籍仍按现有规则处理对话消息，不新增跨重启草稿恢复。

### 布局与拖拽

- 按实际安全区内的窗口宽度判断，采用现有宽屏断点 **680dp**，同时要求横屏；不依赖设备型号。横竖屏使用当前应用窗口的非键盘压缩尺寸判断（结合现有键盘状态），键盘弹起不能把竖屏误判为横屏；系统分屏仍以应用实际窗口为准。
- AI 初始占可用宽度约 **40%**，阅读区和 AI 区各至少 **320dp**，中间分隔条占 **24dp**；分栏阈值同时满足两侧最小宽度及分隔条之和。
- 中间显示细分隔线和短拖拽柄，24dp 宽的触摸区域只占分隔条、不覆盖正文或消息；使用已有 `PanResponder`。向左拖动增宽 AI，向右拖动增宽书籍，实时限制边界；取消手势/旋转时结束本次拖拽，不沿用旧窗口的起点。
- 在移动端 settings store 增加本机 `readerAiPanelRatio` 与 `setReaderAiPanelRatio`，初始 0.4；仅在拖拽结束时保存，不更新跨端设置的 `settingsUpdatedAt`。窗口变小时只夹紧实际宽度，不覆盖用户偏好；恢复宽屏时按偏好重算。不进入跨端阅读设置，不与 PC 的 px 宽度互相覆盖。
- AI 与目录/笔记/搜索使用同一个辅助区，切换工具时替换右栏，避免挤成三栏。AI 内历史会话使用抽屉，在 AI 区域内展开。
- 沿用阅读器主题与现有 AI 样式。320dp AI 栏头部将模型选择与主要操作分行，保证长模型名不挤掉关闭/历史/新会话/导出按钮，主要按钮保持可触摸尺寸。

### 状态和现有功能

- 将 `BookChatScreen` 的对话内容提为 `BookChatContent`，原页面保留为导航与 SafeArea 外壳；阅读器直接嵌入同一内容组件，不增加新的 AI 服务或第二套会话状态。
- 阅读器的 AI 浮动按钮及选区提问统一打开 AI 辅助区；窄屏是在当前阅读器之上的全屏呈现。保留 `BookChat` 路由，原有独立页面入口仍可使用。
- 首次打开后，将 AI 内容保留在辅助区同一组件树位置；分栏/全屏/隐藏只改样式和可交互状态，不更换父级或 key。阅读 WebView 也不重建、不重新开书。换书时重置该书籍的临时引用和草稿。
- 连续选区提问通过带唯一 ID 的选区请求注入引用：每次用户操作只处理一次，包括重复选择同一段；不要求引用数组为空，不覆盖已有草稿。
- 当前书籍引用通过 `goToCFISafely` 和现有 `bridge.flashHighlight` 原位定位；分栏保留 AI 可见，全屏时收起 AI 让正文可见。其他书籍继续走 `openMobileBook` 的文件检查与导航。
- 在 AI 全屏/输入时加入现有音量翻页门禁；隐藏的 AI 不响应正文触摸、返回键、键盘或无障碍焦点，隐藏/切工具时收起其历史抽屉和弹层、取消输入聚焦，但保留草稿。返回先处理 AI 内部弹层/键盘，再收起 AI；阅读器失焦后不拦截设置页返回。
- 安全区由外壳统一负责，嵌入内容不重复加边距；复用现有键盘避让，避免 Android resize 与额外避让造成双重空白。

## 已发现

- `packages/app-expo/src/screens/ReaderScreen.tsx` 的 AI 浮动按钮及选区提问均导航到 `BookChat`。
- `packages/app-expo/src/screens/BookChatScreen.tsx` 已包含书籍 AI 的完整对话逻辑，并有宽屏下常驻历史侧栏；嵌入后应以 AI 区域尺寸判断，避免占用阅读空间。
- `packages/app-expo/src/screens/reader/ReaderAuxiliaryPane.tsx` 已有目录/笔记/搜索的右侧停靠结构，可参考复用。
- `packages/app/src/hooks/use-resizable-panel.ts` 是 PC 拖拽及宽度持久化逻辑，依赖 DOM/localStorage，不能直接在原生端运行。
- `packages/app-expo/src/hooks/responsive-layout.ts` 以实际内容宽度 `>= 680` 判断 `supportsSplitView`；分栏条件应额外要求横屏，不能只检测设备型号或 Android。
- 阅读器已有 `readerSize` 测量、`goToCFISafely` 与纯阅读音量翻页门禁；嵌入 AI 后要以剩余阅读区计算布局、当前书籍引用原位跳转，并在 AI 输入时禁用音量翻页。
- `BookChatScreen` 当前依赖导航返回/设置/引用跳转，选区初始化只在 quotes 为空时注入；嵌入后重复选区提问需要独立事件处理，不能丢掉第二次选区。
- `packages/core/src/hooks/use-streaming-chat.ts` 已按书籍在 chat store 中管理流式会话；直接复用，不增加第二套流式状态或请求。`ChatInput` 草稿仍依赖组件不被重挂载。
- Android 已有自适应窗口插件及 `softwareKeyboardLayoutMode: "resize"`，此次不改 Manifest/方向限制；AI 自身的键盘避让和 SafeArea 要避免与阅读器重复计算。

## Files to modify

| 路径 | 改动 |
| --- | --- |
| `packages/app-expo/src/screens/ReaderScreen.tsx` | 两个 AI 入口、同书引用回调、AI 内容生命周期、分栏宽度、关闭/返回及音量翻页门禁 |
| `packages/app-expo/src/screens/reader/ReaderAuxiliaryPane.tsx` | 扩展辅助区类型支持 AI；增加 AI 内容位、全屏样式与隐藏交互隔离；保留其他工具行为 |
| `packages/app-expo/src/screens/BookChatScreen.tsx` | 保留路由外壳，复用提取后的内容，继续处理设置导航及独立页面的引用跳转 |
| `packages/app-expo/src/components/chat/BookChatContent.tsx`（新增） | 从现有页面移动对话实现；接收 bookId、关闭/设置/引用回调、选区请求和嵌入标记，适配实际区域尺寸 |
| `packages/app-expo/src/screens/reader/ReaderAIResizeHandle.tsx`（新增） | 局部 PanResponder 拖拽柄，处理结束/取消、实时宽度限制、无障碍增减调节 |
| `packages/app-expo/src/screens/reader/reader-ai-layout.ts`（新增） | 小型纯函数集中处理分栏资格、比例和宽度边界，供真实布局/手势及测试共用 |
| `packages/app-expo/src/stores/settings-store.ts` | 增加本机分栏比例默认值及更新方法，接入现有持久化与恢复默认值 |
| `packages/app-expo/src/screens/reader/reader-ai-layout.test.ts`（新增） | 测试真实布局函数和拖拽边界 |
| `packages/app-expo/src/screens/reader/reader-ai-integration.test.ts`（新增） | 用现有 Vitest 模式执行真实状态/回调，覆盖入口、选区及显示切换；不复制生产逻辑 |

不预定修改 PC、core AI 协议、原生配置或 WebView 模板；先复用现有尺寸重排。若真实回归暴露正文位置问题，再限定修复并重建对应 HTML 产物。

## Reuse

- `packages/app-expo/src/components/chat/MessageList.tsx`、`packages/app-expo/src/components/chat/ChatInput.tsx`、`packages/app-expo/src/components/chat/ModelSelector.tsx`：消息、草稿、发送/停止与模型选择，复用原组件。
- `packages/core/src/hooks/use-streaming-chat.ts`、`packages/app-expo/src/stores/chat-store.ts`：已有按书籍管理的流式会话、活动线程和消息持久化。
- `packages/app-expo/src/hooks/use-responsive-layout.ts`、`packages/app-expo/src/hooks/responsive-layout.ts`：实际内容测量及 680dp 断点；AI 内布局取自身区域宽度。
- `packages/app-expo/src/screens/reader/ReaderAuxiliaryPane.tsx`：互斥的目录/笔记/搜索及右侧停靠结构。
- `packages/app-expo/src/components/reader/ReadingProgressSlider.tsx`：PanResponder 手势及 ref 避免旧闭包的现有用法。
- `packages/app-expo/src/stores/persist.ts`：settings store 已有持久化，无需新增存储依赖。
- `packages/app-expo/src/screens/ReaderScreen.tsx` 的 `goToCFISafely`、`suppressProgressTracking`，及 `packages/app-expo/src/hooks/use-reader-bridge.ts` 的 `flashHighlight`：引用原位跳转和高亮。
- `packages/app-expo/src/lib/library/open-mobile-book.ts`：跨书引用保留文件存在检查与重新导入提示。
- `packages/app-expo/src/hooks/use-keyboard-insets.ts`：键盘状态；`packages/app-expo/assets/reader/reader.template.html`：正文随宽度重排及阅读锚点保持。
- `packages/app/src/hooks/use-resizable-panel.ts`、`packages/app/src/components/reader/ReaderView.tsx`：参考 PC 交互，不直接复用 DOM/localStorage 代码。

## Steps

- [x] 明确分栏触发条件与旋转/折叠时的交互。
- [x] 确认 AI 状态、引用跳转、阅读区域测量及辅助面板之间的依赖。
- [x] 将书籍 AI 内容提取为共享组件，保持独立 `BookChat` 路由的原有行为。
- [x] 扩展辅助区支持 AI，统一浮动按钮和选区入口；保持阅读/对话实例，接入同书原位引用及跨书导航。
- [x] 增加分栏纯函数与局部拖拽柄，接入本机比例持久化、尺寸变化及全屏切换。
- [x] 完成窄栏头部、历史抽屉、键盘、安全区、Android 返回和音量翻页门禁。
- [x] 补充针对性测试，执行静态检查与真实正文重排；已构建并原地安装 release，剩余原生交互验收按用户要求跳过。

## 执行结果

- 已实现横屏宽窗口左书右 AI、24dp 分隔条拖拽、两侧至少 320dp、本机比例持久化；竖屏/窄窗使用当前阅读器内的全屏 AI。
- 共享对话内容保留独立路由；显示模式切换与关闭不重建输入框，会话、草稿及选区引用保持。同书引用原位定位，跨书继续走原入口。
- 定向 Vitest：5 个文件、43 项通过；app-expo TypeScript 通过；10 个新增/提取及直接改动文件 Biome 通过。ReaderScreen 和 settings-store 仍有基线已有的 hooks、unused、any 及格式告警，未做无关重构。
- 真实 reader.html 隔离浏览器：63 个主状态、11 个 PDF 双页补充状态、41 次文字锚点可见性检查通过。宽度变化不重开书、不缩字号。细节见 `artifacts/foldable-ai-split/verification.md`。
- PDF 应用设置有既有 `Cannot read properties of null (reading 'Range')`，位置 `packages/foliate-js/pdf.js:269`。单纯改变阅读区宽度不触发；本次未修改 PDF 引擎。
- Android `assembleRelease` 成功；与已安装版本签名一致，`adb install -r` 原地升级成功。升级前后书库可见文字一致；保留旧 APK 于 `/tmp/readany-installed-before-ai-split.apk`。
- 已看到真机横屏左右分栏；未确认手势拖拽、键盘、流式回答跨折叠与旋转等完整交互。用户于本次实施中要求“跳过真机验收”，已停止设备操作，不将这些项目记为通过。

## Verification

### 自动检查（实施阶段执行）

- 对新增真实纯函数测试：679/680dp 临界值、安全区、大/小比例夹紧、横/竖屏、左右拖拽、异常持久化值；窗口夹紧不重写偏好。状态/手势测试补充旋转中止、取消手势及竖屏弹键盘不触发分栏。
- 对真实集成状态/回调测试：两个入口一致；第二次及相同文本再次选区能附加且不重复消费；当前书籍引用不导航新页、跨书保留原入口；改变呈现模式不重挂载输入框或 WebView、不重复发起请求。不能只用源码包含字符串断言替代行为验证；原生组件无法在 Vitest 中验证的项目纳入设备检查。
- 在 `packages/app-expo` 执行受影响测试：`pnpm exec vitest run src/screens/reader/reader-ai-layout.test.ts src/screens/reader/reader-ai-integration.test.ts src/hooks/use-responsive-layout.test.ts src/screens/reader/adaptive-window.test.ts`。
- 执行 `pnpm --filter @readany/app-expo exec tsc --noEmit`，并用 `pnpm exec biome check <实际修改的文件>` 检查改动；已有问题单列，不为清告警做无关重构。

### 原生端验收

1. 用同一书籍在折叠屏展开横屏点击 AI：左书右 AI；翻页/选区与 AI 消息滚动可独立操作；右栏关闭后正文扩回。
2. 拖动分隔线至两端，检查 320dp 最小栏宽、输入框与按钮完整；松手后重新打开及重启应用恢复比例。大字号、长模型名、明暗主题下操作仍可达。
3. 输入草稿、附加引用并启动一次流式回答，连续横屏→竖屏→折叠窄屏→展开横屏；草稿、活动会话、已有/流式消息、阅读位置保持，无重复请求。
4. 验证重复选区、同书引用原位跳转及提示高亮；窄屏引用收起 AI 回正文；跨书引用仍经过原有文件检查。验证历史会话、模型/设置导航、新会话、导出/复制、发送/停止仍可用。
5. AI、目录、笔记、搜索来回切换，不出现三栏或越界；隐藏 AI 不抢触摸/返回键。键盘弹出收起、系统分屏缩放和拖拽中旋转后布局稳定。
6. Android 返回先收键盘/内部弹层，再关闭 AI；AI 输入时音量键不翻页，纯阅读时按原设置恢复；听书继续且浮球位置可达。
7. 普通手机保持全屏 AI；独立 `BookChat` 路由和 PC 版无交互回归。iPad 仅在现有系统允许的横屏窗口下应用同一布局，不改 iOS 方向策略。

### 正文重排与交付条件

- 复用真实 `packages/app-expo/assets/reader/reader.html` + 隔离 EPUB 的浏览器验收链路，连续模拟阅读区缩窄/扩宽，检查原段落仍可见，单/双页随剩余宽度适配，不缩小字号强塞双页；补查 PDF 固定排版与滚动模式。
- 浏览器验收只证明正文重排。拖拽、键盘、折叠切换及 RN UI 必须使用真机或模拟器；若设备不可用，交付时明确保留该验收缺口，不以 HTML 仿真界面代替。
- 规划阶段未运行构建/测试、未改业务代码；实施不新增依赖，不扩展为通用多窗布局系统。
