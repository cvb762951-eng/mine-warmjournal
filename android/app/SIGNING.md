# 签名说明

本项目的签名密钥**不入库**。`.gitignore` 已排除 `*.jks`、`*.keystore`、`keystore.properties`，
以及 CI 里从 Secret 解码出来的临时密钥文件。

## 构建时的签名优先级

从高到低，谁先满足用谁：

1. **环境变量**（CI / GitHub Actions 用）—— 四个变量都齐、且密钥文件确实存在才生效：
   - `ANDROID_KEYSTORE_PATH` —— 密钥文件路径（绝对路径或相对 `android/app`）
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
2. **`android/keystore.properties`** —— 本机自用（该文件不入库）。
3. **`android/app/mine-update.keystore`** —— 若本机存在则使用（该文件不入库）。
4. **Android 默认 debug 签名** —— 兜底；任何情况下都能构建。

任何时候 Gradle 都**只读**这些来源，不会把口令写进仓库里的任何文件。

## 面向协作者

- 克隆仓库后直接 `./gradlew assembleDebug` 就能构建出可安装的 APK（走上面的第 4 条兜底）。
- 想正式对外分发自己的构建，请自己生成密钥，并用上面第 1 或第 2 条提供：

  ```bash
  keytool -genkeypair -v -keystore my-release.keystore -alias my-key \
    -keyalg RSA -keysize 2048 -validity 10000
  ```

## 重要提醒

**换用不同的密钥签名后，新包无法覆盖安装在旧包之上**（Android 会因签名不一致而拒绝安装）。
如果一直自用并需要覆盖升级，请**沿用同一把密钥**，并递增 `versionCode`。

密钥与证书指纹的记录见 `SIGNING-NOTE.md`。

## CI（GitHub Actions）

签名材料放在仓库 Secrets 里，由工作流取用：

| Secret | 用途 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 密钥文件的 base64（工作流里解码成临时文件，用完即弃） |
| `ANDROID_KEYSTORE_PASSWORD` | 对应上面的第 1 条环境变量 |
| `ANDROID_KEY_ALIAS` | 同上 |
| `ANDROID_KEY_PASSWORD` | 同上 |

工作流只把解码后的临时密钥文件放在 runner 的临时目录，**不提交、不出现在日志里**。
