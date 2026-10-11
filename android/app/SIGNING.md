# 签名说明

本目录包含 `mine-update.keystore`，这是本项目的**开发用签名密钥**。

## 它是什么

- 用于本地构建、自用安装以及覆盖升级同一个 APK。
- 口令是 **`android` / `android`**，即 Android 平台**公开的调试密钥默认值**，不是任何个人或组织的私有密钥，**不包含隐私信息**。
- 任何 Android 项目的 debug 构建默认都会生成同样性质的密钥。

## 面向协作者

- 你无需做任何配置，直接 `./gradlew assembleDebug` 即可构建出可安装的 APK。
- 如果你想**正式对外分发**自己的构建版本，请生成你自己的密钥，并在项目根目录创建
  `android/keystore.properties`（该文件已被 `.gitignore` 排除，不会提交）：

  ```properties
  storeFile=/绝对路径/你的密钥.keystore
  storePassword=你的口令
  keyAlias=你的别名
  keyPassword=你的口令
  ```

  生成密钥示例：

  ```bash
  keytool -genkeypair -v -keystore my-release.keystore -alias my-key \
    -keyalg RSA -keysize 2048 -validity 10000
  ```

- 构建时会**优先使用** `keystore.properties` 中指定的密钥；若不存在，则回退到本目录的开发密钥；
  若开发密钥也不存在，再回退到 Android 默认 debug 签名——**任何情况下都能构建**。

## 重要提醒

**换用不同的密钥签名后，新包无法覆盖安装在旧包之上**（Android 会因签名不一致而拒绝）。
若你一直在自用并需要覆盖升级，请**沿用同一个密钥**。
