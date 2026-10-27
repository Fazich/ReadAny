# 移动端共享提取器恢复与职责整理

## 背景（Context）

本计划处理本轮代码审查确认的两项问题：

- 空闲时 WebView 进程终止，队列进入未就绪状态，却因没有活动请求而不重建页面；同代 `ready` 又被组件过滤，后续提取持续失败。
- 应用级共享提取器仍由 `auto-vectorize-service.ts` 保存和暴露 React ref，手动向量化因此依赖自动向量化模块，服务契约反向依赖 UI。

目标：空闲与执行中的故障都有可用的恢复路径，页面生命周期有单一所有者，三个业务调用方通过独立的提取接口使用同一 WebView。

计划已批准并完成实现；验证结果和原生验收缺口记录于文末。

## 方案（Approach）

### 1. WebView 管页面，队列管请求

`ExtractorWebView` 保留单调递增的页面代次，用一个 `loading / ready / failed` 状态替代零散失败标记。事件处理先校验代次；重建时同步递增代次，再更新 React key，使旧页面回调立即失效。

| 事件 | 处理 |
| --- | --- |
| 当前页面 `onLoadStart` | 清理旧请求并进入 `loading`，不请求再次重建；已标记失败的旧页面不能用迟到的加载事件恢复自己。 |
| 当前加载页面收到 `ready` | 进入 `ready`，通知队列可以提取。 |
| 已就绪页面进程终止、页面报错，或执行请求超时/注入失败 | 先结算失败请求，再自动重建一次，进入新代 `loading`；空闲时同样重建。 |
| 新页面在 `loading` 期间继续报错或进程终止 | 进入 `failed`，拒绝同代迟到 `ready`，停止自动重建。 |
| `failed` 状态收到新的提取调用 | 触发一次新代重建；本次调用仍以现有 `not ready` 错误结束，页面 `ready` 后再次调用可成功。 |
| 旧代消息、重复故障、组件卸载后的回调 | 忽略；卸载时拒绝所有请求并释放计时器。 |

这使已就绪页面每次故障都有一次自动恢复机会；连续加载失败时，每次后续调用最多触发一次重试，不形成后台重建循环。未就绪期间继续立即拒绝请求，不增加等待队列、自动重放或重试计时器。

`ExtractionRequestQueue.reset(error)` 只标记未就绪、拒绝请求和释放资源，删除 `hadActive` 决定页面重建的分支。队列仅在活动请求超时或同步注入失败时发出失效通知，由组件执行同一恢复入口；保留当前活动请求错误与排队请求 reset 错误的区别。排队但尚未发送的请求到期只移除自身。

`onLoadStart` 目前也调用 `reset()`，因此不能把 reset 简单改成无条件重建。页面生命周期保留在组件内，无须另建生命周期管理器。

### 2. 共享服务拥有提取契约

新增 `packages/app-expo/src/lib/rag/extraction-service.ts`，只导入 core 的 `ChapterData` 类型，提供：

- `ChapterExtractor`：`extractChapters(base64BookData: string, mimeType?: string): Promise<ChapterData[]>`。
- `setChapterExtractor(provider: ChapterExtractor | null)`：由唯一 Host 在挂载/卸载时注册和清理。
- `extractChapters(base64BookData, mimeType)`：调用方唯一业务入口；未注册时返回拒绝的 Promise，错误沿用 `Extractor WebView not ready`。

`ExtractorWebView` 与 Host 从服务模块导入契约；Host 内部保留 React ref，服务不暴露 ref 或 provider getter。手动向量化、自动向量化和 Host 的 fallback provider 均改为调用服务函数，继续通过同一真实请求队列串行执行。

删除 `auto-vectorize-service.ts` 中的实例变量、`setExtractorRef()`、`getExtractorRef()` 及 UI 类型导入，使其只管理自动向量化队列和进度。未注册时统一走各调用方已有错误处理；自动向量化会进入现有 `error` 回调，替代原先只警告后跳过的路径，避免状态停留在 `extracting`。

### 3. 控制范围

保留 requestId 协议、45 秒入队截止时间、失败请求不自动重放、fallback 缓存与文件安全检查、各调用方现有格式策略和应用级单一 Host。章节解析、可见阅读器与向量化业务调度不作重构；本轮不新增依赖。

## 修改文件（Files to modify）

- `packages/app-expo/src/components/rag/ExtractorWebView.tsx`
- `packages/app-expo/src/components/rag/extraction-request-queue.ts`
- `packages/app-expo/src/components/rag/extraction-request-queue.test.ts`
- `packages/app-expo/src/components/rag/ExtractorHost.tsx`
- `packages/app-expo/src/lib/rag/auto-vectorize-service.ts`
- `packages/app-expo/src/screens/library/useVectorizationQueue.ts`
- 新增 `packages/app-expo/src/lib/rag/extraction-service.ts` 与 `packages/app-expo/src/lib/rag/extraction-service.test.ts`。
- 新增 `packages/app-expo/src/lib/rag/auto-vectorize-service.test.ts`，验证提取入口迁移后的错误状态。
- 新增 `packages/app-expo/src/components/rag/ExtractorWebView.test.tsx`，覆盖真实组件事件连接与重渲染。
- `App.tsx` 中的单一 Host 挂载、core fallback 服务、阅读器模板和生成的 HTML 无须因本次修复变更。

## 复用（Reuse）

- 现有 `ExtractionRequestQueue` 的串行调度、45 秒入队截止时间、请求 ID 校验和释放逻辑。
- 现有 `ExtractorHost` 的应用级挂载、fallback provider 注册与清理。
- `packages/app-expo/src/lib/rag/auto-vectorize-book.ts` 的 `resolveMobileBookPath()` 与 `inspectMobileBookForVectorize()`；Host 保留现有文件检查、编码和 MIME 策略。
- `packages/core/src/ai/fallback-content-service.ts` 的 `setFallbackContentProvider()` 及其缓存、45 秒 provider 超时；核心模块无须修改。
- `packages/app-expo/src/screens/reader/extraction.test.ts` 的脚本隔离测试，以及现有 Vitest fake timers。

## 实施步骤（Steps）

- [x] 先补组件回归：驱动真实 `onContentProcessDidTerminate` 和 `onRenderProcessGone` 回调，证明当前空闲故障不能恢复；使用真实队列，不由测试直接调用 `markReady()` 代替页面 `ready`。
- [x] 新增独立提取服务及注册/注销测试，更新组件、Host 和两个向量化调用方，删除自动向量化模块里的实例存储与 getter/setter。
- [x] 将队列 `reset()` 改为纯请求清理，超时/注入失败通过失效通知交给组件；组件按上表统一管理页面恢复。
- [x] 扩展故障、迟到响应、重渲染和卸载用例，保留已有队列与阅读器提取回归。
- [x] 运行下列针对性检查，检查依赖方向与剩余旧接口引用，记录原生设备验收结果或明确缺口。

## 验证（Verification）

### 自动化验收

Expo 已有 Vitest、fake timers 和 esbuild，未安装 React 组件测试库。测试使用轻量 hook/WebView 替身运行真实组件回调并驱动重渲染，仅替换 React Native/Expo 环境，保留真实队列与恢复逻辑，不新增测试依赖。

- **空闲恢复**：`ready → iOS/Android 进程终止回调 → key 变化 → 新代 ready → 新请求发送并成功结算`。
- **故障去重与旧代隔离**：保留旧页面回调，在重渲染前后重复发故障、`ready` 与提取结果，不能二次重建或影响新请求。
- **执行中恢复**：活动请求和排队请求各拒绝一次，计时器清零，不重放旧书；新页面就绪后新请求成功。超时和同步注入异常走同一恢复入口。
- **加载失败**：`onLoadStart` 不递归重建；首次加载失败或重建后再次失败都停止自动重试；下一次提取调用只触发一次新代重建并返回 `not ready`，随后页面就绪能正常提取。
- **卸载**：在途 Promise 全部结算，捕获的旧回调不能重建页面；Host 清理共享 provider 和 fallback provider。
- **服务边界**：注册后参数和结果正确透传，未注册/注销后明确拒绝；业务模块不再导入组件类型，也不再引用旧 getter/setter。服务测试只替换 provider，不替换被测服务。
- **自动向量化错误状态**：运行真实 `queueBook()` 和独立提取服务；未注册 provider 时，状态从 `extracting` 转为 `error`，向量化不会启动，业务队列能退出处理状态。仅替换下游向量化入口，避免访问真实模型和存储。
- 继续运行已有串行、requestId、排队截止时间、解析错误、PDF 和可见书籍隔离测试。

```bash
pnpm --filter @readany/app-expo exec vitest run src/components/rag/extraction-request-queue.test.ts src/components/rag/ExtractorWebView.test.tsx src/lib/rag/extraction-service.test.ts src/lib/rag/auto-vectorize-service.test.ts src/screens/reader/extraction.test.ts
pnpm --filter @readany/app-expo exec tsc --noEmit --pretty false
git diff --check
```

使用仓库现有 Biome 对本次改动文件运行只读检查，处理新增问题。本轮不修改 reader 模板或构建脚本，因此不要求重新生成 `reader.html`。

### 原生验收

在可用的 Android/iOS 开发设备或模拟器，用测试书籍验证：空闲时终止 WebView 内容进程后恢复提取；提取中终止后当前任务失败、下一次可成功；切换书库和阅读页后手动向量化、自动向量化与 fallback 原文搜索继续使用单一 Host。fallback 检查使用未缓存内容，避免缓存掩盖故障。

进程终止必须针对 WebView 内容进程，不能以终止整个 App 代替。组件内存测试与原生运行证据分别记录；设备不可用时，交付中保留这项未验收内容，不把回调模拟写成真机通过。

## 执行记录

- 修复前新增的 iOS/Android 空闲进程终止测试均能复现页面 key 不变的问题；修复后通过。
- 计划列出的 5 个测试文件共 30 个测试通过，包含真实组件回调、真实请求队列、共享服务、自动向量化错误退出和已有阅读器提取回归。
- Expo TypeScript 检查和 `git diff --check` 通过。
- 仓库现有 Biome 1.9.4 对本次改动的 10 个文件只读检查通过；检查期间修正 Hook 依赖声明、测试类型与格式问题。由于命令包装层异常，最终通过 Node 调用同一已安装 Biome CLI 完成检查，未安装依赖。
- 全仓 TypeScript/TSX 中已无 `setExtractorRef`、`getExtractorRef`、`ExtractorRef`；共享服务只依赖 core 类型，两个向量化调用方和 fallback 均使用服务入口，App 中仍只有一个 Host。
- 实现时原生验收未执行：当时 `adb devices -l` 无连接设备，`xcrun simctl list devices booted` 返回 `unable to find utility "simctl"`。空闲和执行中内容进程终止、跨页面后的三类业务入口仍需按上节步骤验收，恢复逻辑的现有证据为组件回调内存测试。
- 后续已在连接的 Android 手机上完成 release 覆盖升级：重新生成阅读器资源并通过 5 项提取回归；`assembleRelease -PreactNativeArchitectures=arm64-v8a` 成功，包名 `com.readany.app`、版本 `1.3.7`，签名与已安装包一致；`adb install -r` 返回 `Success`，应用 UID、数据目录和首次安装时间保持一致。
- 升级后书库正常显示，核对的阅读进度 `3%`、`36%` 保留；本地书籍能打开，并恢复到升级前的「1.1.3 云计算技术成熟」。屏幕尺寸变化导致分页数重排；未执行 WebView 内容进程终止的真机故障注入。
