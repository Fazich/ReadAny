# TTS 试听失败恢复修复计划

## Context

Android 端朗读方案里除系统语音外试听全部无声。第一阶段已修复主因：`tts-preview.ts` 改用 `rnTTSPlayerFactories`（原先 DashScope 试听实际播放系统语音）、失败经 `onError` 上报、删除了废弃的 `expo-av-edge-player.ts`。

随后的代码质量审查用故障注入复现了三个仍未解决的问题，以及一个测试缺陷：

1. **取消不生效（P1）**：`TrackPlayerEdgeTTSPlayer.speak()`（`packages/app-expo/src/lib/platform/track-player-edge-player.ts:68-71`）和 `TrackPlayerDashScopeTTSPlayer.speak()`（`packages/app-expo/src/lib/platform/track-player-dashscope-player.ts:66-68`）在 `await this._cleanup()` 期间被 `stop()` 时，`stop()` 不递增 `_speakGen`，启动流程恢复后仍继续初始化：Edge 在 `:104` 注册 4 个原生监听，DashScope 在 `:72-75` 触发 "DashScope API key is required"。快速连点试听就会命中。
2. **过期试听仍弹窗（P2）**：`packages/app-expo/src/screens/settings/TTSSettingsScreen.tsx:145-151` 的 `onError` 在 `endPreviewFeedback(run)` 提前返回后仍执行 `Alert.alert`；根因是 `tts-preview.ts` 的 4 个模块级单例在 `stopTTSPreview()` 后仍持有并触发旧回调。
3. **Edge 错误契约不完整（P2）**：`track-player-edge-player.ts:176-187` 原生播放错误重试耗尽只发 `"stopped"`；`:298-307` `_startPlayback` 在队列为空时把失败当正常结束（`onEnd`）。Cloud（`:322 _failPlayback`）和 DashScope（`:631 _failPlayback`）已有统一范式，Edge 没有。
4. **测试覆盖错位（P2）**：`packages/app-expo/src/lib/platform/tts-preview.test.ts` 全量 mock 播放器、用 `globalThis.__ttsPlayers` 共享对象，只验证引擎分派，发现不了上述生命周期缺陷。

用户已确认：顺带把试听重构成单实例；Edge 失败改为报错停止；正式朗读（tts-store）的错误展示本次不动。

## Approach

四个部分，共享一条主线——**让「取消」成为可判定的状态，而不是靠时间竞态**。

### A. 播放器取消语义（P1 根因）

`stop()` 递增代次，让在途启动失效；`speak()` 在每次 `await` 之后重新校验代次。

- `track-player-edge-player.ts`：`stop()`（`:703`）首行加 `this._speakGen += 1`；`speak()` 在 `await TrackPlayer.reset()` 之后、`_subscribeToEvents(gen)` 之前加 `if (gen !== this._speakGen) return;`。
- `track-player-dashscope-player.ts`：`stop()`（`:713`）首行加 `this._speakGen += 1`；`speak()` 内 `await TrackPlayer.reset()` 之后同样补校验。

依据：Cloud 已用这个写法（`track-player-cloud-tts-player.ts:301`）且验证有效；两条既有检查 `:71`（Edge）和 `:68`（DashScope）说明代次机制本来就存在，只是 `stop()` 漏了递增。

### B. Edge 统一失败出口（P2）

新增私有 `_failPlayback(error)`，照抄 Cloud `:322-332` 的形态（幂等 `_stopped` 守卫、清事件、`TrackPlayer.stop/reset` 兜底 catch、先 `onStateChange("stopped")` 再 `onError`）。替换三处：

- `:183-187` 重试耗尽 → `_failPlayback(new Error("Edge TTS playback failed after retries"))`
- `:276-282` producer catch → `_failPlayback(err)`（保留原 `"aborted"` 与 `_stopped` 判断条件）
- `:302-307` 队列为空（从未播出声音）→ `_failPlayback(new Error("Edge TTS produced no audio"))`

`_startPlayback` 的空队列分支不再调 `onEnd`。符合 `packages/core/src/tts/types.ts:409-412` 的契约（`onError` 后不得跟 `onEnd`）。这会把正式朗读中「无声静默结束」变成「报错停止」，用户已确认接受。

### C. 试听单实例（P2 根因 + 结构）

`tts-preview.ts` 从 4 个模块级单例改为一个 `activePreview: ITTSPlayer | null`，每次试听现建实例并接管，回调透传前校验 `activePreview === player`。

关键点：`stopTTSPreview()` 先清空回调再 `stop()`，避免播放器内部 `onStateChange("stopped")` 打到已取消的 UI 回调；`previewTTSConfig` 的 catch 分支用同一身份校验丢弃过期错误。身份比较取代了原来的「停止所有 4 个实例」遍历。

引擎分派保持现有映射，系统语音仍用 `new ExpoSpeechTTSPlayer()`（不切到 `createSystemTTS`：那需要 `canUseSystemTtsSynthesis()` 判断原生模块，而系统语音试听当前可用，属于另一项改动）。

UI 层（`TTSSettingsScreen.tsx`）不改：过期回调在 `tts-preview` 就被丢弃，`Alert` 不会误弹。8 秒兜底超时（`:47`）保留，用于网络挂起。

### D. 测试

- 重写 `tts-preview.test.ts`：去掉 `globalThis.__ttsPlayers`，改用 `vi.hoisted` 收集每次工厂创建的实例（与 `track-player-cloud-tts-player.test.ts:4-31` 同风格）。新增两个用例：换方案试听时旧实例回调不再透传；`stopTTSPreview()` 后旧实例回调不再透传。
- 新增 `track-player-cancellation.test.ts`：mock `react-native-track-player`（`reset` 返回手动 resolve 的 promise，`addEventListener` 记录 handler）。覆盖：Edge 初始化期间 `stop()` 后不再注册监听；DashScope 初始化期间 `stop()` 后不上报缺 Key；Edge `getQueue()` 返回空时上报 `onError` 且不调 `onEnd`。

## Files to modify

| 文件 | 改动 |
| --- | --- |
| `packages/app-expo/src/lib/platform/track-player-edge-player.ts` | `stop()` 递增代次；`speak()` reset 后校验；新增 `_failPlayback`；三处终止路径改用它 |
| `packages/app-expo/src/lib/platform/track-player-dashscope-player.ts` | `stop()` 递增代次；`speak()` reset 后校验 |
| `packages/app-expo/src/lib/platform/tts-preview.ts` | 4 单例 → 单 `activePreview`，身份校验透传回调 |
| `packages/app-expo/src/lib/platform/tts-preview.test.ts` | 重写 mock 方式，补取消/过期用例 |
| `packages/app-expo/src/lib/platform/track-player-cancellation.test.ts` | 新增，覆盖 A 与 B 的边界 |

不改：`TTSSettingsScreen.tsx`（C 已解决其根因）、`packages/core/src/stores/tts-store.ts`、`tts-store.ts` 的跨包类型。

## Reuse

- `track-player-cloud-tts-player.ts:297-332` — `stop()` 递增代次与 `_failPlayback` 的现成范式，直接照搬形态。
- `track-player-cloud-tts-player.test.ts:4-31` — `vi.hoisted` + mock `expo-file-system` / `react-native` / `react-native-track-player` 的测试骨架。
- `packages/app-expo/src/lib/platform/rn-tts-factories.ts` — 引擎到播放器的唯一分派表，单实例重构继续用它。
- `packages/core/src/tts/types.ts:398-413` — `ITTSPlayer` 接口，`tts-preview` 的 `activePreview` 类型来源。
- `tts-preview.ts:44` 的注释（回调须在 `speak` 前挂上）——重构后依然成立，保留。

## Steps

- [x] 1. `track-player-edge-player.ts`：`stop()` 加 `this._speakGen += 1`；`speak()` 在 `await TrackPlayer.reset()` 后加 `if (gen !== this._speakGen) return;`
- [x] 2. `track-player-dashscope-player.ts`：同上两处
- [x] 3. `track-player-edge-player.ts`：新增 `_failPlayback(error)`（幂等守卫 + 清事件 + stop/reset 兜底 + stopped 后 onError）
- [x] 4. 用 `_failPlayback` 替换重试耗尽（`:183-187`）、producer catch（`:276-282`）、空队列（`:302-307`）三处
- [x] 5. `tts-preview.ts`：改为 `let activePreview: ITTSPlayer | null`，新增 `createPreviewPlayer(engine)` 分派，重写 `stopTTSPreview` / `previewTTSConfig`
- [x] 6. 重写 `tts-preview.test.ts`（`vi.hoisted` + 实例数组），补取消与过期回调用例
- [x] 7. 新增 `track-player-cancellation.test.ts`，覆盖 Edge/DashScope 取消和 Edge 空队列
- [x] 8. 跑测试与 biome，处理回归

## Verification

自动化：

```bash
pnpm --filter @readany/app-expo test     # 新增/重写的用例全绿
pnpm test:core                           # core 未受影响
pnpm lint                                # biome check 无新增告警
```

手动（Android 真机/模拟器，`pnpm expo:android`）：

1. 设置 → 语音朗读，依次试听 Edge / DashScope / 小米 / OpenAI-compatible：无 Key 时弹窗显示具体原因，不再是 8 秒静默。
2. 快速连点试听按钮 3 次：只出现一次弹窗，且来源是最后一次，无旧实例的重复提示。
3. 试听中点停止，或离开页面：不再弹任何错误。
4. Edge 播放在飞行模式下试听：8 秒内弹出网络/协议错误，且 `isPreviewing` 正确复位。
5. 回归系统语音试听仍有声（此次未改其路径）。
