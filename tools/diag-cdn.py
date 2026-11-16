import json, sys, urllib.request
cookie = sys.argv[1]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
h = {"user-agent": UA, "referer": "https://music.163.com/", "cookie": f"MUSIC_U={cookie}"}
api = "https://music.163.com/api/song/enhance/player/url?id=21527159&ids=%5B21527159%5D&br=320000"
with urllib.request.urlopen(urllib.request.Request(api, headers=h), timeout=30) as r:
    print("api:", r.status)
    item = (json.load(r).get("data") or [{}])[0]
real = item.get("url")
print("real:", (real or "")[:70])
for label, hdrs in [("无头", {}), ("带头", h)]:
    try:
        with urllib.request.urlopen(urllib.request.Request(real, headers=hdrs), timeout=30) as r:
            print(f"CDN {label}: {r.status} {r.headers.get('content-type')}")
    except Exception as e:
        print(f"CDN {label}: {type(e).__name__} {e}")
