"""
FastAPI Web 后端 — 智能旅行助手 HTTP API（Session 隔离版）

提供:
- GET  /              → 前端聊天界面
- POST /api/chat      → 同步对话
- POST /api/chat/stream → SSE 流式对话（token 级推送 + 工具调用可视化）
- POST /api/reset     → 重置当前会话

Session 管理:
  每个浏览器自动分配独立的 session_id（Cookie），
  不同用户 / 设备拥有完全隔离的 Agent 实例和对话历史。
  24 小时无活动自动清理。
"""

import sys
import os
import json
import uuid
import time
import socket
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from agent import TravelAgent

app = FastAPI(title="小途 · 智能旅行助手", version="3.0.0")

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ============================================================
# Session Manager — 每个用户独立 Agent
# ============================================================

SESSION_TTL = 24 * 3600  # 24 小时无活动自动过期
CLEANUP_INTERVAL = 3600  # 每小时清理一次过期 session


class SessionManager:
    """管理多用户 Agent 实例"""

    def __init__(self):
        self._sessions: dict[str, tuple[TravelAgent, float]] = {}  # sid -> (agent, last_access)
        self._lock = threading.Lock()
        self._start_cleanup()

    def get_agent(self, session_id: str) -> TravelAgent:
        """获取或创建 session 对应的 Agent"""
        with self._lock:
            now = time.time()
            entry = self._sessions.get(session_id)
            if entry is not None:
                agent, _ = entry
                self._sessions[session_id] = (agent, now)  # 刷新时间
                return agent
            # 新 session
            agent = TravelAgent()
            self._sessions[session_id] = (agent, now)
            return agent

    def reset(self, session_id: str):
        """重置指定 session 的对话历史"""
        with self._lock:
            entry = self._sessions.get(session_id)
            if entry is not None:
                entry[0].reset()

    def _start_cleanup(self):
        """后台定期清理过期 session"""
        def _clean():
            while True:
                time.sleep(CLEANUP_INTERVAL)
                with self._lock:
                    now = time.time()
                    expired = [
                        sid for sid, (_, last) in self._sessions.items()
                        if now - last > SESSION_TTL
                    ]
                    for sid in expired:
                        del self._sessions[sid]
                    if expired:
                        print(f"[Session] Cleaned {len(expired)} expired sessions, {len(self._sessions)} active")

        t = threading.Thread(target=_clean, daemon=True)
        t.start()


session_manager = SessionManager()

# Cookie 名
SESSION_COOKIE = "xiaotu_sid"


# ============================================================
# 启动事件
# ============================================================

@app.on_event("startup")
async def startup_banner():
    local_ip = _get_local_ip()
    banner = f"""
============================================================
  XiaoTu AI Travel Assistant
  http://localhost:8080
  http://127.0.0.1:8080
"""
    if local_ip:
        banner += f"""
  LAN: http://{local_ip}:8080
"""
    banner += """============================================================
"""
    for line in banner.strip().split('\n'):
        try:
            print(line)
        except UnicodeEncodeError:
            print(line.encode('ascii', errors='replace').decode('ascii'))


def _get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ""


# ============================================================
# 请求模型
# ============================================================

class ChatRequest(BaseModel):
    message: str


# ============================================================
# 页面路由
# ============================================================

@app.get("/", response_class=HTMLResponse)
async def index():
    index_path = TEMPLATES_DIR / "index.html"
    return HTMLResponse(index_path.read_text(encoding="utf-8"))


# ============================================================
# API 路由（Session 隔离）
# ============================================================

@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    """同步对话 — 按 session 隔离"""
    sid = request.cookies.get(SESSION_COOKIE)
    is_new_session = sid is None
    if is_new_session:
        sid = uuid.uuid4().hex[:16]

    if not req.message.strip():
        return {"reply": "请输入您的问题"}

    agent = session_manager.get_agent(sid)

    try:
        reply = agent.chat(req.message)
        resp = JSONResponse({"reply": reply})
        if is_new_session:
            resp.set_cookie(key=SESSION_COOKIE, value=sid, max_age=SESSION_TTL, httponly=True, samesite="lax")
        return resp
    except Exception as e:
        return {"reply": f"出错了：{str(e)}"}


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    """SSE 流式对话 — 按 session 隔离"""
    sid = request.cookies.get(SESSION_COOKIE)
    is_new_session = sid is None
    if is_new_session:
        sid = uuid.uuid4().hex[:16]

    if not req.message.strip():
        async def empty_gen():
            yield _sse_event("token", json.dumps({"content": "请输入您的问题"}, ensure_ascii=False))
            yield _sse_event("done", "{}")
        resp = StreamingResponse(empty_gen(), media_type="text/event-stream")
        if is_new_session:
            resp.set_cookie(key=SESSION_COOKIE, value=sid, max_age=SESSION_TTL, httponly=True, samesite="lax")
        return resp

    agent = session_manager.get_agent(sid)

    async def event_generator():
        try:
            for event in agent.chat_stream(req.message):
                yield _sse_event(event["type"], json.dumps(event, ensure_ascii=False))
        except Exception as e:
            yield _sse_event("error", json.dumps({"error": str(e)}, ensure_ascii=False))

    resp = StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    if is_new_session:
        resp.set_cookie(key=SESSION_COOKIE, value=sid, max_age=SESSION_TTL, httponly=True, samesite="lax")
    return resp


@app.post("/api/reset")
async def reset(request: Request):
    """重置当前 session 的对话历史"""
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        session_manager.reset(sid)
    return {"status": "ok", "message": "对话已重置"}


def _sse_event(event_type: str, data: str) -> str:
    return f"event: {event_type}\ndata: {data}\n\n"


# ============================================================
# 启动入口
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web.app:app", host="0.0.0.0", port=8080, reload=True)
