# AI 对话消息编辑与重新发送

## Context

用户在 AI 思考或生成回答时发现已发送的问题有误，希望直接修改原问题后重新发送。截图中目前通过停止生成、再追加消息来修正，留下重复问题和取消提示。

目标：从已发送的用户消息进入编辑，修改后在原会话位置重新提问，保留此前上下文；取消编辑不改历史。

## Approach

- 在用户消息旁增加“编辑”入口，回填现有输入框，并显示“正在编辑消息”、取消和重新发送操作。
- 点击编辑遇到该会话正在生成时，立即停止旧生成并允许修改；重发前等待旧请求及终态保存收尾，再替换原问题和后续对话。
- 编辑提示中说明“重新发送将清除这条消息之后的对话”。提交前保留历史；取消编辑恢复原先未发送的正文、引用和选项，已停止的生成保持停止。
- 编辑状态绑定 `threadId`、`messageId` 和书籍；切换会话、书籍或新建会话时退出编辑并隔离旧的异步提交。
- 复用共享发送、停止、消息 Parts 与引用能力，保持桌面端和手机端行为一致。
- 已确认：允许编辑任意历史问题；重新发送后清除该问题之后的旧对话，从这里重新生成。
- 已确认：桌面端和手机端一起支持，覆盖普通 AI 聊天和书籍 AI 对话。
- 已核实：`chat-store.updateMessage` 只修改内存的 `content`，不会更新 SQLite、`partsOrder` 或后续消息，不能直接用于编辑重发。
- 已核实：停止生成会异步保存含 `aborted` Part 的回答；`StreamingChat` 的结束回调目前不等待异步落库。编辑必须等待旧生成及其终态写入收尾，并隔离旧回调。
- 已核实：启动生成前会等待技能加载、历史摘要和书籍刷新；此时底层 `AbortController` 尚未建立，必须让停止操作也覆盖准备阶段。
- 已核实：会话存在持久化摘要，删改历史后须清空 `memorySummary`、`memoryUpdatedAt`、`memoryMessageCount`，再基于保留的前文重新计算，防止旧内容继续影响回答。
- 已核实：消息同步用 `created_at` 比较新旧，仅更新原 ID 的正文和 `sync_version` 无法可靠同步。采用删除原问题及其后续消息、记录同步 tombstone、插入新 ID 的修订问题；新问题仍接在保留的前文之后，无需改数据库 schema 或同步协议。
- 在同一个事务中校验完整消息及会话快照，再完成删除、tombstone、新问题写入和会话摘要重置；快照变化时整体拒绝并保留编辑草稿，用户可重试。消息及会话同步版本在事务内推进；修订及删除时间晚于旧历史最大时间，支持慢时钟增量同步。提交成功后才替换内存历史并通知输入框消费草稿。
- 已核实：现有 `IDatabase` 只有 `execute/select/close`。Expo 对单条操作排队，桌面端使用 Tauri SQL 连接池；不能把跨多次 `await` 的 `BEGIN/COMMIT` 当作可靠事务。历史替换、删除记录和摘要重置必须放进适配器提供的单次原子写入。
- 已核实：用户消息的 `content` 含发给模型的引用拼接内容，编辑应优先从 `TextPart/QuotePart` 恢复完整正文、引用及来源，并兼容旧消息。
- 已核实：手机输入框已有 `onAccepted` 接收确认，桌面输入框目前发送即清空；两端需统一到提交成功后清空，失败时保留编辑内容。

## Files to modify

- 共享流程：`packages/core/src/hooks/use-streaming-chat.ts`、`packages/core/src/ai/streaming.ts`、`packages/core/src/stores/chat-store.ts`；覆盖普通发送、停止及编辑重发的并发和收尾。
- 原子保存：`packages/core/src/db/message-queries.ts`、`packages/core/src/db/database.ts`、`packages/core/src/services/platform.ts`；增加消息历史替换操作和参数化批量事务接口。
- 数据库适配：`packages/app/src/lib/platform/tauri-platform-service.ts`、`packages/app-expo/src/lib/platform/expo-platform-service.ts`、`packages/cli/src/platform/node-platform.ts`。桌面端在 `packages/app/src-tauri/src/db/mod.rs` 增加单连接事务命令，并在 `packages/app/src-tauri/src/lib.rs` 注册；使用已有 `rusqlite`。
- 原文恢复：`packages/core/src/utils/chat-utils.ts`；复用 Parts 转换，提取可编辑正文与引用。
- 桌面界面：`packages/app/src/components/chat/MessageList.tsx`、`packages/app/src/components/chat/ChatInput.tsx`、`packages/app/src/components/chat/ChatPage.tsx`、`packages/app/src/components/chat/ChatPanel.tsx`。
- 手机界面：`packages/app-expo/src/components/chat/MessageList.tsx`、`packages/app-expo/src/components/chat/ChatInput.tsx`、`packages/app-expo/src/components/chat/BookChatContent.tsx`、`packages/app-expo/src/screens/ChatScreen.tsx`。
- 文案：`packages/core/src/i18n/locales/{en,es,fr,ja,ko,zh,zh-TW}/chat.json`。
- 回归：扩展 `packages/core/src/hooks/use-streaming-chat.test.ts`、`packages/core/src/stores/chat-store.test.ts`、`packages/core/src/db/__tests__/message-queries.test.ts`、`packages/core/src/utils/chat-utils.test.ts`、`packages/core/src/sync/__tests__/simple-sync.integration.test.ts`、`packages/app-expo/src/components/chat/BookChatContent.test.tsx`，并为事务失败回滚增加实际 SQLite 检查。

## Reuse

- `packages/core/src/hooks/use-streaming-chat.ts`：`sendMessage`、`stopStream`、按书籍隔离的 `activeStreams`。
- `packages/core/src/stores/chat-store.ts`：会话、消息、流式状态的现有集中管理。
- `packages/core/src/types/message.ts`：`MessageV2`、`TextPart`、`QuotePart`；`packages/core/src/utils/chat-utils.ts` 的 `convertToMessageV2` 兼容旧消息。
- 两端现有 `MessageList`、`ChatInput`：消息展示、引用、深度思考、防剧透和停止按钮；沿用原有图标、样式和可访问性规范。
- `packages/app-expo/src/components/chat/ChatInput.tsx` 的 `onAccepted`：持久化成功后消费发送快照，失败保留草稿。
- Expo 的 `SQLITE_OPERATION_QUEUES`、`expo-sqlite` 事务能力、Node 的 `better-sqlite3.transaction` 和桌面端已有 `rusqlite`；复用现有连接对应的数据库路径，不增加依赖。

## Steps

- [x] 确认任意历史问题、重发清除后续对话、双端普通及书籍聊天的范围。
- [x] 核实发送调用方、停止与保存顺序、引用格式、摘要、同步冲突和三种数据库适配器。
- [x] 补充 `IDatabase` 参数化批量事务能力：Expo 在现有队列内独占执行，Node 使用同步事务，Tauri 在一次原生命令中用同一连接提交或回滚；不在共享层跨 `await` 拼接 `BEGIN/COMMIT`。
- [x] 增加共享历史替换操作：校验目标仍属于指定会话且为用户消息；按实际消息顺序截断，原子删除原问题及后续、记录 tombstone、插入修订问题并清空摘要。失败时历史和内存不变；成功后一次更新 store。
- [x] 完善生成生命周期：准备开始即登记可取消的请求，结束回调等待落库；按请求身份校验晚到回调，停止和重发等待旧任务收尾，避免旧摘要或旧回答重新写回。复用共享生成流程，不再追加第二条用户消息。
- [x] 两端接入编辑入口和现有输入框。首次编辑保存普通草稿快照，回填完整正文与引用并聚焦；取消恢复快照。提交期间防止重复操作，验证配置与目标后再保存；收到接受确认后结束编辑。网络失败沿用现有错误反馈，修订问题仍可再次编辑。
- [x] 覆盖所有普通与书籍聊天入口，以及现有 `sendMessage`、`stopStream` 调用方；保持普通发送、停止、引用、深度思考和防剧透可用。
- [ ] 完成定向回归、实际事务回滚检查及桌面/手机交互验收。自动回归和桌面隔离浏览器交互已通过；手机原生与完整 Tauri 应用交互仍待可用设备/运行环境验收。

## 实施验证记录

- 审查反馈修复：平台重复的编辑 hook 已合并到 core；新增共享 `useChatSubmit`，四个普通/书籍聊天入口统一处理配置、停止、提交和接受确认。手机 `BookChatContent` 从 1015 行减至 980 行。
- Core 定向 Vitest：7 个文件、65 项通过，包含真实生成 hook 的摘要取消、旧请求收尾、保存失败、事务快照冲突、慢时钟顺序，以及共享编辑/提交 hook 的上下文隔离。
- Expo 组件及阅读器相关回归：3 个文件、41 项通过，包含编辑、取消、切换目标和旧接受回调/旧 finally 的隔离；测试宿主加载真实 core 编辑与发送 hook。
- CLI 实际 SQLite：6 项通过。第二连接在读取后、事务前插入消息或修改正文/摘要/线程时，过期替换被原子拒绝；重试后返回值与数据库一致并覆盖晚插入消息的 tombstone。另验证末尾写入失败整体回滚、数据库重开、慢时钟增量同步和旧快照回放不复活旧消息。
- 桌面 Rust：使用本机 Rust 1.95 工具链运行 DB 测试，3 项通过，覆盖快照冲突、正常提交及失败回滚；默认 Rust 1.87 低于现有依赖最低要求。
- Core、桌面、Expo TypeScript 检查通过；顺带修正桌面 EPUB 元数据读取的一行 ArrayBuffer 类型错误，并验证带偏移视图的字节复制。
- 使用真实桌面 MessageList、ChatInput 和 core `useChatSubmit` 的隔离浏览器页面，验证停止后编辑、取消恢复草稿/引用、历史问题编辑、保存失败保留内容、重发截断及窄屏深色无溢出；另验证配置等待期间重复发送被禁用、切走再切回后旧提交失效。
- 当前无已连接 Android 设备、无 iOS 模拟器；未完成 Expo 原生与完整 Tauri 应用的人工联调，因此最后一步保留待验收。

## Verification

- 在桌面和 Expo 的普通聊天、书籍聊天中，分别验证准备中、思考中、生成中、已完成和已取消的消息编辑；手机入口可直接触达，桌面支持键盘聚焦操作。
- 编辑历史问题后，前文保留，原问题及后续被替换为一条修订问题和新回答；AI 输入不再包含旧问题、旧回答或失效摘要。
- 取消编辑恢复原草稿、引用和选项；引用全文与来源可回填和移除；纯引用问题可发送，空白正文且无引用不可提交。
- 用可控延迟模拟旧流结束、终态落库和准备阶段摘要写入，确认重发等待收尾，晚到回调不会复活旧回答或清除新流状态；切换会话/书籍和快速连点不会发错位置或重复提交。
- 配置校验、数据库保存失败时保留编辑内容和完整历史；在真实 SQLite 中注入事务中途失败，确认消息、tombstone 和摘要一起回滚。保存成功后模拟网络失败，确认修订问题只出现一次且仍能编辑。
- 关闭并重开会话，检查持久化与显示一致；交换两端同步数据，确认修订问题可同步、旧问题和后续不会复活，覆盖相同时间戳及设备时钟偏差。
- 实施阶段运行 core 与 Expo 上述文件的定向 Vitest，执行相关 TypeScript 检查和桌面 Rust 事务测试，并在真实桌面与 Expo 环境操作主要路径。规划阶段只修改本计划，不运行测试、构建或安装。
