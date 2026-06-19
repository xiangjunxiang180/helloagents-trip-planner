"""
Agent 核心循环 — 基于 ReAct + Function Calling 模式的智能旅行助手。

工作流程：
1. 接收用户输入
2. 将对话历史 + 工具定义发送给 LLM
3. LLM 决定是直接回复还是调用工具
4. 若调用工具 → 执行工具 → 结果返回 LLM → 继续循环
5. 若直接回复 → 流式返回最终结果给用户（token 级推送）
"""

import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional, Generator
from openai import OpenAI
import config
from .tools import TOOL_DEFINITIONS, TOOL_MAP


# ========== System Prompt ==========

def _build_system_prompt() -> str:
    """构建包含当前日期的 System Prompt，防止 LLM 编造日期。"""
    today = datetime.now()
    date_str = today.strftime("%Y年%m月%d日")
    weekday = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][today.weekday()]
    return f"""你是一个智能旅行助手 🌍，名字叫「小途」。你的任务是为用户提供专业的旅行规划和建议。

## ⏰ 当前时间
今天是 **{date_str} {weekday}**。你必须严格基于这个日期来思考和规划所有行程。
天气数据来自实时 API，所有日期都是真实准确的。永远不要编造过去的日期（如2024年）。

## 🧠 对话记忆（极其重要！）
- **你必须记住对话历史中的所有关键信息**：目的地、日期、人数、偏好、预算等
- 当用户说"刚才说的""之前提到的""那个地方"等，务必回溯之前的对话找到准确信息
- 当用户说"从XX出发怎么去"，你必须结合之前提到过的目的地来回答，**绝不反问"你想去哪里"**
- 例如：用户之前说"去西安玩"，现在问"从西宁出发推荐到达方式"→ 你应该推荐从西宁到**西安**的交通方式
- **绝对不要忘记用户在第一句话就告诉你的目的地！**

## 你的核心能力：
- 🔍 **天气查询**：通过 get_weather 工具获取目的地的实时或未来天气
- 🖼️ **目的地预览**：通过 search_destination_images 搜索目的地的精美图片
- 📋 **行程规划**：通过 generate_itinerary 生成每日行程计划，并结合你的知识丰富细节

## 工作规范：
1. **主动使用工具**：当用户询问天气、想看目的地图片、或需要行程规划时，务必调用对应工具获取真实数据
2. **综合回复**：如果同时需要天气 + 行程，可以连续调用多个工具，然后将所有信息整合成一份完整回复
3. **行程要详细**：生成的每日行程要包含具体的景点名、推荐美食、交通建议、住宿提示
4. **关注实用细节**：提醒最佳旅游季节、必备物品、注意事项、预算估算
5. **友好热情**：使用友好、热情的语气，适当使用 emoji 增加亲和力
6. **图片展示**：如果获取到了图片，在回复中用 Markdown 格式展示图片链接
7. **安全提醒**：在行程建议中包含必要的安全提示
8. **日期正确**：严格遵守当前日期 {date_str}，所有行程日期基于此计算

## 回复格式：
- 使用 Markdown 格式
- 结构清晰，分点说明
- 先总结，再展开细节
- 天气信息要突出显示
- 行程按天组织，每天分上午/中午/下午/晚上
"""


# ========== Agent 类 ==========

class TravelAgent:
    """智能旅行助手 Agent"""

    def __init__(self):
        self.client = OpenAI(
            api_key=config.LLM_API_KEY,
            base_url=config.LLM_BASE_URL,
        )
        self.model = config.LLM_MODEL
        self.max_tool_calls = config.MAX_TOOL_CALLS
        self.messages: list[dict] = []

    def _execute_tool(self, name: str, arguments: dict) -> str:
        """执行工具调用并返回字符串结果"""
        func = TOOL_MAP.get(name)
        if not func:
            return json.dumps({"success": False, "error": f"未知工具: {name}"}, ensure_ascii=False)

        try:
            result = func(**arguments)
            return json.dumps(result, ensure_ascii=False, indent=2)
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)

    def chat(self, user_input: str) -> str:
        """
        处理用户输入，运行 Agent 循环（同步模式）。

        Args:
            user_input: 用户消息文本

        Returns:
            Agent 的最终回复文本
        """
        if not self.messages:
            self.messages.append({"role": "system", "content": _build_system_prompt()})

        self.messages.append({"role": "user", "content": user_input})

        tool_call_count = 0

        while tool_call_count < self.max_tool_calls:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
            )

            message = response.choices[0].message

            if message.tool_calls:
                self.messages.append({
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in message.tool_calls
                    ],
                })

                # 并行执行所有工具
                if len(message.tool_calls) == 1:
                    tc = message.tool_calls[0]
                    tool_result = self._execute_tool(tc.function.name, json.loads(tc.function.arguments))
                    self.messages.append({"role": "tool", "tool_call_id": tc.id, "content": tool_result})
                else:
                    with ThreadPoolExecutor(max_workers=len(message.tool_calls)) as executor:
                        futures = {
                            executor.submit(self._execute_tool, tc.function.name, json.loads(tc.function.arguments)): tc.id
                            for tc in message.tool_calls
                        }
                        for future in as_completed(futures):
                            tc_id = futures[future]
                            self.messages.append({
                                "role": "tool", "tool_call_id": tc_id, "content": future.result(),
                            })

                tool_call_count += 1
            else:
                reply = message.content or ""
                self.messages.append({"role": "assistant", "content": reply})
                return reply

        return "抱歉，处理您的请求时遇到了问题。请尝试更具体地描述您的旅行需求。"

    def chat_stream(self, user_input: str) -> Generator[dict, None, None]:
        """
        处理用户输入，流式返回 Agent 的每一步操作（SSE 模式）。

        工具调用阶段：立即推送 tool_start / tool_end 事件
        最终回复阶段：使用 stream=True，逐 token 推送 text 事件

        产生的消息类型:
            {"type": "thinking", "content": "正在分析您的需求..."}
            {"type": "tool_start", "name": "get_weather", "args": {...}}
            {"type": "tool_end", "name": "get_weather", "result": {...}}
            {"type": "token", "content": "文"}   ← token 级流式输出
            {"type": "done"}

        Args:
            user_input: 用户消息文本

        Yields:
            事件字典
        """
        if not self.messages:
            self.messages.append({"role": "system", "content": _build_system_prompt()})

        self.messages.append({"role": "user", "content": user_input})

        tool_call_count = 0

        while tool_call_count < self.max_tool_calls:
            # 工具调用阶段使用非流式（必须拿到完整的 tool_call 决策）
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
            )

            message = response.choices[0].message

            # ---- 如果 LLM 决定调用工具 ----
            if message.tool_calls:
                tool_info_list = []
                for tc in message.tool_calls:
                    tool_name = tc.function.name
                    tool_args = json.loads(tc.function.arguments)
                    tool_info_list.append((tc.id, tool_name, tool_args))
                    # 立即通知前端：工具开始调用
                    yield {"type": "tool_start", "name": tool_name, "args": tool_args}

                self.messages.append({
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc_id,
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)},
                        }
                        for tc_id, name, args in tool_info_list
                    ],
                })

                # 并行执行所有工具（天气 + 图片 可同时请求）
                if len(tool_info_list) == 1:
                    # 单个工具：直接执行
                    tc_id, tool_name, tool_args = tool_info_list[0]
                    tool_result = self._execute_tool(tool_name, tool_args)
                    yield {"type": "tool_end", "name": tool_name, "result": json.loads(tool_result)}
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": tool_result,
                    })
                else:
                    # 多个工具：并行执行
                    with ThreadPoolExecutor(max_workers=len(tool_info_list)) as executor:
                        futures = {
                            executor.submit(self._execute_tool, name, args): (tc_id, name)
                            for tc_id, name, args in tool_info_list
                        }
                        for future in as_completed(futures):
                            tc_id, tool_name = futures[future]
                            tool_result = future.result()
                            yield {"type": "tool_end", "name": tool_name, "result": json.loads(tool_result)}
                            self.messages.append({
                                "role": "tool",
                                "tool_call_id": tc_id,
                                "content": tool_result,
                            })

                tool_call_count += 1

            # ---- LLM 决定直接回复（最终回复）：使用流式 ----
            else:
                # 发送 thinking 信号让前端知道开始生成文本
                yield {"type": "thinking", "content": "正在生成回复..."}

                # 使用 stream=True 进行 token 级流式输出
                stream = self.client.chat.completions.create(
                    model=self.model,
                    messages=self.messages,
                    tools=TOOL_DEFINITIONS,
                    tool_choice="auto",
                    stream=True,
                )

                full_reply = ""
                for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        full_reply += delta.content
                        yield {"type": "token", "content": delta.content}

                # 将完整的 assistant 回复加入对话历史
                self.messages.append({"role": "assistant", "content": full_reply})
                yield {"type": "done"}
                return

        yield {"type": "token", "content": "抱歉，处理您的请求时遇到了问题。请尝试更具体地描述您的旅行需求。"}
        yield {"type": "done"}

    def reset(self):
        """重置对话历史"""
        self.messages = []


# ========== 便捷入口 ==========

def run_agent(user_input: str, agent: Optional[TravelAgent] = None) -> str:
    """
    运行 Agent 处理单条消息的便捷函数。

    Args:
        user_input: 用户消息
        agent: 可复用已有 Agent 实例，None 则创建新实例

    Returns:
        Agent 回复
    """
    if agent is None:
        agent = TravelAgent()
    return agent.chat(user_input)
