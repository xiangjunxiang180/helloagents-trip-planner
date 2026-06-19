"""
外网隧道工具 — 让任何人都能通过公网 URL 访问你的旅行助手

用法:
    python tunnel.py              # 使用 ngrok（需先注册获取 authtoken）
    python tunnel.py --cloudflare # 使用 Cloudflare Tunnel（推荐，免费无注册）

前置条件（二选一）：
  方案 A: ngrok
    1. 注册 https://ngrok.com
    2. 获取 authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
    3. pip install pyngrok
    4. ngrok config add-authtoken <你的token>

  方案 B: Cloudflare Tunnel（推荐）
    1. 下载 cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    2. 安装后直接运行 python tunnel.py --cloudflare
"""

import subprocess
import sys
import time
import argparse


def start_ngrok(port: int = 8080):
    """使用 pyngrok 创建公网隧道"""
    try:
        from pyngrok import ngrok, conf
    except ImportError:
        print("[ERROR] 请先安装 pyngrok: pip install pyngrok")
        print("然后注册 ngrok 获取 authtoken: https://ngrok.com")
        return

    try:
        http_tunnel = ngrok.connect(port, "http")
        print("=" * 55)
        print("  [OK] ngrok 隧道已建立！")
        print(f"  公网地址: {http_tunnel.public_url}")
        print("  任何人都可以通过这个地址访问你的旅行助手")
        print("=" * 55)
        print()
        print("按 Ctrl+C 停止...")
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n隧道已关闭")
    except Exception as e:
        print(f"[ERROR] ngrok 启动失败: {e}")
        print("请确认: 1) 已安装 pyngrok  2) 已配置 authtoken")
        print("运行: ngrok config add-authtoken <你的token>")


def start_cloudflare(port: int = 8080):
    """使用 cloudflared 创建公网隧道（免费，无需注册）"""
    try:
        # 尝试启动 cloudflared
        proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        print("正在启动 Cloudflare Tunnel...")
        print("(首次使用会自动生成证书，请稍候)\n")

        for line in proc.stdout:
            line = line.strip()
            if "trycloudflare.com" in line:
                # 提取公网 URL
                import re
                match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
                if match:
                    url = match.group(0)
                    print("=" * 55)
                    print("  [OK] Cloudflare Tunnel 已建立！")
                    print(f"  公网地址: {url}")
                    print("  任何人都可以通过这个地址访问你的旅行助手")
                    print("=" * 55)
            print(f"  [cloudflared] {line}")

        proc.wait()

    except FileNotFoundError:
        print("[ERROR] 未找到 cloudflared，请先安装：")
        print()
        print("  Windows:")
        print("    下载: https://github.com/cloudflare/cloudflared/releases/latest")
        print("    选择 cloudflared-windows-amd64.exe 放到 PATH 目录下")
        print()
        print("  Mac:")
        print("    brew install cloudflared")
        print()
        print("  Linux:")
        print("    wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64")
        print("    chmod +x cloudflared-linux-amd64")
        print("    sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared")
    except KeyboardInterrupt:
        print("\n隧道已关闭")


def main():
    parser = argparse.ArgumentParser(description="外网隧道工具")
    parser.add_argument("--port", "-p", type=int, default=8080, help="本地服务端口")
    parser.add_argument("--cloudflare", "-c", action="store_true", help="使用 Cloudflare Tunnel")
    args = parser.parse_args()

    if args.cloudflare:
        start_cloudflare(args.port)
    else:
        start_ngrok(args.port)


if __name__ == "__main__":
    main()
