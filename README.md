# 🌍 小途 · 智能旅行助手

> AI-Powered Travel Assistant — 基于 **ReAct + Function Calling** 架构的智能旅行规划 Agent

[![Python](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## ✨ 功能特色

| 能力 | 说明 | 数据源 |
|------|------|--------|
| 🌤️ **实时天气** | 查询目的地实时天气 + 未来 4 天预报 | 高德地图 API |
| 📸 **目的地预览** | 搜索目的地高清实景照片（非 AI 生成） | Unsplash |
| 📋 **智能行程** | 按天规划详细行程（景点/美食/交通/住宿/预算） | 通义千问 AI |
| 🧠 **多轮记忆** | 记住对话上下文，不用重复说目的地 | Session 隔离 |
| ⚡ **流式输出** | Token 级实时推送，不用等完整回复 | SSE |

## 🏗️ 架构设计

```
用户 → 浏览器 (HTML/CSS/JS)
         ↓ SSE 流式
      FastAPI (web/app.py)
         ↓ Session 管理
      Agent 核心 (agent/core.py)
         ↓ ReAct 循环
      ┌──────┼──────┐
  天气工具  图片工具  行程工具
 (高德API) (Unsplash) (LLM)
```

**ReAct 循环流程：**
1. 用户输入 → 加入对话历史
2. LLM 决策：直接回复？还是调用工具？
3. 若调用工具 → 并行执行 → 结果返回 LLM → 回到步骤 2
4. 若直接回复 → `stream=True` → 逐 token 推送前端

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/xiangjunxiang180/helloagents-trip-planner.git
cd helloagents-trip-planner
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 配置 API 密钥

创建 `.env` 文件，填入以下内容：

```env
# 通义千问 API（阿里云百炼平台）
LLM_API_KEY=sk-your-key-here

# 高德地图 Web API
AMAP_WEATHER_KEY=your-amap-key

# Unsplash Access Key
Unsplash_Access_Key=your-unsplash-key
```

> 💡 **API 获取地址：**
> - 通义千问：[阿里云百炼](https://bailian.console.aliyun.com/) → 模型广场 → API-KEY
> - 高德地图：[高德开放平台](https://lbs.amap.com/) → 应用管理 → Web服务
> - Unsplash：[Unsplash Developers](https://unsplash.com/developers) → Your Apps

### 4. 启动服务

```bash
# Web 模式（推荐）
python -m uvicorn web.app:app --host 0.0.0.0 --port 8080

# CLI 模式
python main.py
```

### 5. 打开浏览器

- 本机访问：**http://localhost:8080**
- 局域网访问：**http://你的IP:8080**（手机/其他设备同 WiFi 下可用）

---

## 🌐 外网访问（让任何人都能使用）

### 方案 A：Cloudflare Tunnel（推荐，免费）

1. 下载 [cloudflared](https://github.com/cloudflare/cloudflared/releases)
2. 运行：`python tunnel.py --cloudflare`

### 方案 B：ngrok

```bash
pip install pyngrok
ngrok config add-authtoken <你的token>
python tunnel.py
```

---

## 📁 项目结构

```
helloagents-trip-planner/
├── agent/
│   ├── __init__.py
│   ├── core.py            # 🔥 Agent 核心（ReAct 循环 + SSE 流式）
│   └── tools.py           # 🔧 三大工具：天气/图片/行程
├── web/
│   ├── __init__.py
│   ├── app.py             # 🌐 FastAPI 后端（Session 隔离 + SSE）
│   ├── static/
│   │   ├── style.css      # 🎨 UI 样式
│   │   └── app.js         # ⚡ 前端逻辑（SSE + Markdown 渲染）
│   └── templates/
│       └── index.html     # 🖥️ 聊天界面
├── config.py              # ⚙️ 配置中心
├── main.py                # 💻 CLI 入口
├── tunnel.py              # 🔗 外网隧道工具
├── requirements.txt       # 📦 Python 依赖
└── .gitignore
```

## 🔧 技术栈

- **LLM**：通义千问 (Qwen) — OpenAI 兼容接口，默认 `qwen-turbo`
- **框架**：FastAPI + Uvicorn（异步 Web 服务）
- **前端**：原生 HTML/CSS/JS + marked.js（Markdown 渲染）
- **通信**：Server-Sent Events (SSE) — Token 级流式推送
- **架构模式**：ReAct (Reasoning + Acting) + Function Calling

## 🎯 使用示例

```
🧳 你：我想去成都玩4天，帮我规划行程，先看看天气和美景

🌍 小途：
  [🌤️ 查询天气] → 成都实时天气 + 4天预报
  [📸 搜索图片] → 5张成都实景照片
  [📋 生成行程] → 4天详细行程

  ## 🐼 成都 4 日深度游

  ### Day 1 春熙路 · 太古里 · 火锅之夜
  | 时间 | 内容 |
  |------|------|
  | 上午 | IFS 爬楼熊猫打卡... |
  | 中午 | 龙抄手总店... |
  ...

  ### Day 2 大熊猫基地 · 宽窄巷子
  ...
```

## 📄 License

MIT © [xiangjunxiang180](https://github.com/xiangjunxiang180)
