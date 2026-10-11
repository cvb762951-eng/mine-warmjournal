# 暖色生活志（Mine）

一个**本地优先**的个性化专注与生活记录 Android 应用：日记、账本、味觉档案、专注计时、习惯追踪、私密空间，以及一个可选的 AI 陪伴功能。

> 设计理念：数据默认只存在你自己的手机上。只有你主动开启的 AI 功能才会联网。

---

## 功能概览

| 模块 | 说明 |
|---|---|
| 日记 | 图文日记、草稿、封面、随手拍批量导入 |
| 账本 | 收支记录与分类统计 |
| 味觉档案 | 记录吃过的食物与感受 |
| 专注 | 番茄钟、白噪音、按科目分组统计 |
| 习惯 | 习惯打卡与热力图 |
| 日历 | 按天回顾当天的日记、专注、活动 |
| 统计 | 周 / 月 / 年回顾，AI 周总结展示 |
| 私密空间 | 本地加密的图片与视频，支持非破坏性裁剪 |
| AI 陪伴 | 可选功能，需自行配置 API Key，密钥加密存于本机 |

---

## 技术栈

- **Capacitor 8.5** + **原生 JavaScript**（ES Module，无框架、无 TypeScript）
- **esbuild** 单文件 IIFE 打包
- 本地优先存储（SQLite / 本地状态），数据不出本机
- 三套主题：`classic`（米白）/ `sunny` / `plain`（静蓝）

---

## 目录结构

```
.
├── index.html              # 应用入口
├── app.js                  # 应用装配入口
├── core.js                 # 核心运行时（IoC 注册表）
├── model.js                # 数据模型与默认状态
├── storage.js              # 持久化（含字段白名单）
├── views/                  # 各页面视图
├── ai/                     # AI 陪伴模块
├── scripts/
│   └── build-web.mjs       # Web 构建脚本
├── android/                # Android 原生工程（Capacitor）
├── fonts/  assets/         # 字体与静态资源
└── tests/                  # 单元测试
```

---

## 本地构建

### 前置要求

- Node.js 22+
- JDK 21
- Android SDK（构建 APK 时需要）

### 步骤

```bash
# 1. 安装依赖
npm install

# 2. 构建 web 资源（产出 www/）
node scripts/build-web.mjs

# 3. 同步到 Android 工程
npx cap sync android

# 4. 构建 APK
cd android && ./gradlew assembleDebug
```

产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

> 签名与密钥相关说明见 [`android/app/SIGNING.md`](android/app/SIGNING.md)。

---

## 运行测试

```bash
node --test tests/*.test.mjs
```

---

## 隐私说明

- 应用数据（日记、照片、账本等）**默认只保存在本机**，不上传任何服务器。
- AI 功能默认关闭；开启后需要你自行填写 API Key，密钥在设备上加密存储。
- 「导出到相册」是唯一会把私密空间内容移出应用沙箱的操作，需用户主动触发。

---

## 许可

本项目为个人项目。如需引用或合作，请通过仓库 Issue 联系作者。
