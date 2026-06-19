#!/usr/bin/env python3
"""
智能旅行助手「小途」— 主入口

基于 ReAct + Function Calling 架构的 AI Agent，
集成高德天气、Unsplash 图片搜索、智能行程规划三大工具。

用法:
    python main.py              # 进入交互模式
    python main.py --once "我想去杭州玩3天"   # 单次对话
"""

import sys
import io
import argparse

# ---- 修复 Windows GBK 终端下的 Unicode 输出问题 ----
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from agent import TravelAgent

console = Console(force_terminal=True)

BANNER = """
[bold cyan]
╔══════════════════════════════════════════╗
║          🌍 小途 · 智能旅行助手          ║
║       AI-Powered Travel Assistant        ║
╚══════════════════════════════════════════╝
[/bold cyan]
[dim]💡 集成能力：高德天气 | Unsplash 图片 | AI 行程规划[/dim]
"""

WELCOME_TIPS = """
试试这样问我：
• ✈️  "我想去成都玩4天，帮我做个行程规划"
• 🌤️  "杭州这几天天气怎么样？"
• 🖼️  "让我看看大理的风景"
• 🍜  "推荐一个适合美食之旅的城市，5天行程"
• 🏔️  "冬天想去雪山，有什么推荐？安排3天"
"""


def think_with_spinner(agent: TravelAgent, user_input: str) -> str:
    """带加载动画的 Agent 调用"""
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True,
    ) as progress:
        progress.add_task("[cyan]小途正在思考...", total=None)
        result = agent.chat(user_input)
    return result


def interactive_mode():
    """交互式对话模式"""
    console.print(BANNER)
    console.print(Panel(WELCOME_TIPS.strip(), title="💬 使用指南", border_style="dim"))
    console.print()

    agent = TravelAgent()
    console.print("[green]✅ 小途已就绪！输入你的旅行需求开始对话吧~[/green]")
    console.print("[dim]输入 'exit' 或 'quit' 退出，输入 'reset' 重新开始[/dim]")
    console.print()

    while True:
        try:
            user_input = console.input("[bold yellow]🧳 你: [/bold yellow]").strip()

            if not user_input:
                continue

            if user_input.lower() in ("exit", "quit", "q"):
                console.print("\n[cyan]👋 再见！祝你旅途愉快！[/cyan]")
                break

            if user_input.lower() == "reset":
                agent.reset()
                console.print("[green]🔄 对话已重置[/green]\n")
                continue

            # 调用 Agent 思考
            reply = think_with_spinner(agent, user_input)

            # 渲染回复
            console.print()
            console.print("[bold cyan]🤖 小途:[/bold cyan]")
            console.print(Markdown(reply))
            console.print()

        except KeyboardInterrupt:
            console.print("\n\n[cyan]👋 再见！祝你旅途愉快！[/cyan]")
            break
        except Exception as e:
            console.print(f"\n[red]❌ 错误: {e}[/red]")
            console.print("[dim]请重试，或输入 'reset' 重新开始[/dim]\n")


def single_mode(query: str):
    """单次对话模式"""
    console.print(BANNER)
    console.print(f"[dim]查询: {query}[/dim]\n")

    agent = TravelAgent()

    try:
        reply = think_with_spinner(agent, query)
        console.print("[bold cyan]🤖 小途:[/bold cyan]")
        console.print(Markdown(reply))
    except Exception as e:
        console.print(f"[red]❌ 错误: {e}[/red]")


def main():
    parser = argparse.ArgumentParser(
        description="智能旅行助手「小途」— AI-Powered Travel Assistant"
    )
    parser.add_argument(
        "--once", "-o",
        type=str,
        help="单次对话模式，传入问题直接获取回复",
    )
    args = parser.parse_args()

    if args.once:
        single_mode(args.once)
    else:
        interactive_mode()


if __name__ == "__main__":
    main()
