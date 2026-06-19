"""
配置文件：加载环境变量，集中管理所有 API 密钥和端点。
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ========== 通义千问 LLM ==========
LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
LLM_MODEL = "qwen-turbo"  # 速度最快，响应延迟低；质量要求高时可换 qwen-plus / qwen-max

# ========== 高德地图 ==========
AMAP_WEATHER_KEY = os.getenv("AMAP_WEATHER_KEY")
AMAP_WEATHER_URL = "https://restapi.amap.com/v3/weather/weatherInfo"
AMAP_GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"
AMAP_POI_URL = "https://restapi.amap.com/v3/place/text"

# ========== Unsplash ==========
UNSPLASH_ACCESS_KEY = os.getenv("Unsplash_Access_Key")
UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos"

# ========== Agent 配置 ==========
MAX_TOOL_CALLS = 10  # 最大工具调用轮次，防止无限循环
