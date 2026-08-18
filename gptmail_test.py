import requests

API_KEY = "sk-wtc0LgxI7Cbv"
BASE_URL = "https://mail.chatgpt.org.uk"

headers = {"X-API-Key": API_KEY}

# 1. 随机生成临时邮箱（验证 key 是否有效）
print("=== 生成临时邮箱 ===")
resp = requests.get(f"{BASE_URL}/api/generate-email", headers=headers)
print(f"状态码: {resp.status_code}")
data = resp.json()
print(f"响应: {data}")

if data.get("success"):
    email = data["data"]["email"]
    usage = data.get("usage", {})
    print(f"\n邮箱: {email}")
    print(f"今日已用: {usage.get('used_today')}")
    print(f"今日剩余: {usage.get('remaining_today')}")
    print(f"总额度: {usage.get('total_limit')}")
    print(f"总剩余: {usage.get('remaining_total')}")

    # 2. 查询该邮箱的收件箱
    print(f"\n=== 查询收件箱: {email} ===")
    resp2 = requests.get(f"{BASE_URL}/api/emails", headers=headers, params={"email": email})
    print(f"收件箱: {resp2.json()}")
else:
    print(f"失败: {data.get('error')}")
