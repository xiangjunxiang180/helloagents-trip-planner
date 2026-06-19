"""
工具层：智能旅行助手可调用的所有外部工具。

包含三个核心工具：
1. get_weather       — 通过高德地图 API 获取目标城市天气
2. search_destination_images — 通过 Unsplash API 搜索目的地精美图片
3. generate_itinerary — 基于用户偏好生成每日行程计划（纯 LLM 工具）
"""

import requests
import config


def get_weather(city_name: str, extensions: str = "base") -> dict:
    """
    查询指定城市的天气信息。

    Args:
        city_name: 城市中文名称，如 "北京"、"上海"、"杭州"
        extensions: base 返回实时天气, all 返回未来4天预报

    Returns:
        包含天气信息的字典
    """
    try:
        params = {
            "key": config.AMAP_WEATHER_KEY,
            "city": city_name,
            "extensions": extensions,
        }
        resp = requests.get(config.AMAP_WEATHER_URL, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if data.get("status") != "1":
            return {"success": False, "error": f"高德API返回错误: {data.get('info', '未知错误')}"}

        lives = data.get("lives", [])
        forecasts = data.get("forecasts", [])

        result = {"success": True, "city": city_name}

        if lives:
            live = lives[0]
            result["realtime"] = {
                "天气": live.get("weather"),
                "温度(°C)": live.get("temperature"),
                "风向": live.get("winddirection"),
                "风力": live.get("windpower"),
                "湿度": live.get("humidity"),
                "报告时间": live.get("reporttime"),
            }

        if forecasts:
            forecast = forecasts[0]
            result["forecast"] = []
            for cast in forecast.get("casts", []):
                result["forecast"].append({
                    "日期": cast.get("date"),
                    "星期": cast.get("week"),
                    "白天天气": cast.get("dayweather"),
                    "夜间天气": cast.get("nightweather"),
                    "白天温度(°C)": cast.get("daytemp"),
                    "夜间温度(°C)": cast.get("nighttemp"),
                    "白天风向": cast.get("daywind"),
                    "夜间风向": cast.get("nightwind"),
                    "白天风力": cast.get("daypower"),
                    "夜间风力": cast.get("nightpower"),
                })

        return result

    except requests.RequestException as e:
        return {"success": False, "error": f"网络请求失败: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": f"查询天气失败: {str(e)}"}


def search_destination_images(query: str, per_page: int = 5) -> dict:
    """
    在 Unsplash 上搜索目的地的高质量图片。

    Args:
        query: 搜索关键词，如 "Hangzhou West Lake"、"Beijing Great Wall"
        per_page: 返回图片数量，默认5张

    Returns:
        包含图片URL列表的字典
    """
    try:
        headers = {"Authorization": f"Client-ID {config.UNSPLASH_ACCESS_KEY}"}
        params = {
            "query": query,
            "per_page": per_page,
            "orientation": "landscape",
        }
        resp = requests.get(
            config.UNSPLASH_SEARCH_URL,
            headers=headers,
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        images = []
        for item in data.get("results", []):
            images.append({
                "id": item.get("id"),
                "描述": item.get("description") or item.get("alt_description", "无描述"),
                "作者": item.get("user", {}).get("name", "未知"),
                "图片URL(小)": item.get("urls", {}).get("small"),
                "图片URL(常规)": item.get("urls", {}).get("regular"),
                "下载链接": item.get("links", {}).get("download"),
            })

        return {
            "success": True,
            "query": query,
            "total": data.get("total", 0),
            "images": images,
        }

    except requests.RequestException as e:
        return {"success": False, "error": f"网络请求失败: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": f"图片搜索失败: {str(e)}"}


def generate_itinerary(
    destination: str,
    days: int,
    preferences: str = "综合体验",
    budget: str = "中等"
) -> dict:
    """
    生成旅行行程计划（该工具返回结构化模板，由 Agent 在 LLM 侧深度规划）。
    实际行程内容由 Agent 结合上下文生成，此工具提供结构骨架。

    Args:
        destination: 目的地
        days: 旅行天数
        preferences: 旅行偏好（自然风光/历史文化/美食探索/都市购物/综合体验）
        budget: 预算级别（经济/中等/豪华）

    Returns:
        行程框架字典
    """
    return {
        "success": True,
        "destination": destination,
        "days": days,
        "preferences": preferences,
        "budget": budget,
        "structure": {
            "day_plan_template": {
                "上午": "景点/活动 + 交通方式",
                "中午": "推荐餐厅 + 特色美食",
                "下午": "景点/活动",
                "晚上": "夜市/演出/休闲 + 住宿建议",
            },
            "tips": [
                "每日预留1-2小时弹性时间",
                "景点之间交通时间已考虑",
                "热门餐厅建议错峰用餐",
            ],
        },
    }


# ========== 工具元数据（供 LLM Function Calling 使用） ==========

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询指定城市的实时天气或未来天气预报。在用户询问目的地天气时必须调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "city_name": {
                        "type": "string",
                        "description": "城市中文名称，例如：北京、上海、杭州、成都",
                    },
                    "extensions": {
                        "type": "string",
                        "enum": ["base", "all"],
                        "description": "base=实时天气; all=未来4天预报。需要未来天气时用all",
                    },
                },
                "required": ["city_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_destination_images",
            "description": "在Unsplash上搜索目的地的高质量风景照。当用户想看目的地长什么样、需要旅行灵感时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，建议中英结合，如 'Hangzhou West Lake 西湖'",
                    },
                    "per_page": {
                        "type": "integer",
                        "description": "返回图片数量，默认5",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_itinerary",
            "description": "生成旅行行程计划框架。当用户需要规划行程、想知道每天怎么安排时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "目的地名称",
                    },
                    "days": {
                        "type": "integer",
                        "description": "旅行天数",
                    },
                    "preferences": {
                        "type": "string",
                        "enum": ["自然风光", "历史文化", "美食探索", "都市购物", "综合体验"],
                        "description": "用户的旅行偏好",
                    },
                    "budget": {
                        "type": "string",
                        "enum": ["经济", "中等", "豪华"],
                        "description": "预算级别",
                    },
                },
                "required": ["destination", "days"],
            },
        },
    },
]

# 工具名称 → 实际函数的映射
TOOL_MAP = {
    "get_weather": get_weather,
    "search_destination_images": search_destination_images,
    "generate_itinerary": generate_itinerary,
}
