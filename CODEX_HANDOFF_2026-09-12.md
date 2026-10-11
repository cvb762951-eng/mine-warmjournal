# Mine 暖色生活志：新对话交接

## 当前目标

完成大容量备份 v3 的验证与恢复演练，随后用真实 Android 手机验证约 10.7GB 数据的导出与恢复。验证通过前不要声称“100GB 已实测”。

## 项目与不可破坏边界

- 工作目录：`<本项目本地路径>`
- 这是手机端 App，网页只是真实交互预览。
- 包名必须保持 `com.mine.warmjournal`。
- 签名配置必须保持 `mineUpdate`，keystore 为 `android/app/mine-update.keystore`，不得重建或泄露。
- 当前源码版本为 `1.0.20`、`versionCode 21`。
- `releases/暖色生活志-v1.0.20-覆盖升级.apk` 是后续功能加入前生成的旧包，不包含最新改动。最终重新打包应升到 `1.0.21`、`versionCode 22`，不要覆盖旧包。
- 工作区很脏，包含用户之前的大量修改。禁止 reset、checkout 覆盖、清理未知文件或删除旧 APK。

## 已完成但尚未最终打包的功能

- 私密空间视频流：上下滑动、左右拖动进度、长按 2 倍速、默认静音、系统音量键、收纳侧栏、横屏隐藏选集、Android 边缘手势保护。
- 私密空间批量导入最多 100 项，可复制或在 Android 确认后删除相册原件。
- 私密资料库视频封面统一为 16:9 完整等比显示。
- 私密视频可恢复到随手拍；优先原记录，找不到时按原日期重建，媒体不重复复制或删除。
- 大容量备份前台保活、进度通知和导出进度界面。

## v3 单文件分块备份现状

主要文件：

- `android/app/src/main/java/com/mine/focus/StreamingBackupPlugin.java`
- `android/app/src/main/java/com/mine/focus/BackupChunkCrypto.java`
- `android/app/src/test/java/com/mine/focus/BackupChunkCryptoTest.java`
- `android/app/src/test/java/com/mine/focus/BackupArchiveRoundTripTest.java`
- `tests/streaming-backup.test.mjs`
- `views/mine.js`

实现内容：

- 外部仍是一个 `.minebackup` 文件。
- `FORMAT_VERSION = 3`，每个媒体文件内部按 8MB 分块。
- 每块分别使用 AES-GCM，AAD 包含版本、序号、类型、文件名、总长度、块序号、块数和块长度。
- v3 恢复自动按顺序拼接，并校验清单、连续性、总长度和认证标签。
- 保留 `LEGACY_FORMAT_VERSION = 2` 和 `extractV2Archive()`，新版可以恢复旧 v2。
- 恢复前按当前剩余空间检查单个待恢复文件和 128MB 安全余量。
- 状态 JSON 限制为 8MB，避免再次触发大记录输出缓冲问题。

## 已验证

- Web/Node 全量测试最近结果：295/295 通过。
- Web build 通过。
- Android Release 主代码编译通过。
- `BackupChunkCryptoTest` 在英文临时盘符下实际运行通过：
  - 8MB 块固定输出缓冲加密/解密；
  - 密文篡改拒绝；
  - 块序号替换拒绝。
- `git diff --check` 通过，只有既有 LF/CRLF 提示。

## 当前未完成与准确阻塞

- `BackupArchiveRoundTripTest` 已编译成功，但未实际执行到断言。
- 普通中文路径运行 Gradle 测试时，连项目原有 `ExampleUnitTest` 也出现 `ClassNotFoundException`，是 Gradle 测试工作进程的中文路径问题。
- 尝试用 `M:` 临时英文盘符执行该测试时，自动审批因 Codex 使用额度耗尽而拒绝；不是代码测试失败。
- 没有连接 Android 实机，因此尚未完成 10.7GB 真机导出、选择备份验证、恢复和逐文件比对。
- 产品内“只验证备份、不替换现有数据”的独立入口尚未实现。如果继续“备份验证与恢复演练”功能，应补这个入口：调用 `prepareRestore` 完整解密到临时区，验证 payload 后调用 `rollbackRestore` 清理，不调用 `commitRestore`。

## 新对话下一步

1. 先检查当前 diff 和上述文件，不重做已有功能。
2. 运行生产归档闭环测试：
   - 映射项目到临时英文盘符；
   - 运行 `:app:testReleaseUnitTest --tests com.mine.focus.BackupArchiveRoundTripTest`；
   - 测试必须覆盖跨 8MB 文件逐字节恢复、错误密钥、截断和篡改。
3. 如果测试失败，修根因后重复；不得删测试或放宽标准。
4. 实现 App 内“验证备份文件”入口，验证完成必须清理临时恢复区，绝不提交或覆盖当前数据。
5. 跑 `node --test tests/*.test.mjs`、Web build、Android Release 编译和差异检查。
6. 先提供预览；用户确认或明确要求打包后，升为 `1.0.21` / `versionCode 22`，保留原包名和证书。
7. 真机验收需记录：数据总量、目标位置、导出耗时、文件大小、验证结果、恢复所需空间，以及媒体数量/哈希一致性。

## Android 本机构建环境

- Android SDK：`<Android SDK 路径>`
- Gradle：`<Gradle 可执行文件路径>`
- 中文路径下 JVM 测试类加载不稳定，使用临时英文盘符，结束后解除映射。

## 建议给新 Codex 的第一句话

请读取 `CODEX_HANDOFF_2026-09-12.md`，继续 Mine 暖色生活志的大容量备份验证与恢复演练。不要重做已完成工作，不要清理脏工作区。先执行 `BackupArchiveRoundTripTest`，再实现 App 内只验证不提交的备份验证入口；验证通过前不要打包或宣称 10.7GB 已实测。
