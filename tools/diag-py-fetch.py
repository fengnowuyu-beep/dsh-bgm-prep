import json, urllib.request, gzip, io, sys

cookie = sys.argv[1]
h = {"user-agent": "Mozilla/5.0", "referer": "https://music.163.com/", "cookie": f"MUSIC_U={cookie}"}
url = "https://music.163.com/api/song/enhance/player/url?id=21527159&ids=%5B21527159%5D&br=320000"
req = urllib.request.Request(url, headers=h)
with urllib.request.urlopen(req, timeout=30) as r:
    print("status", r.status, "encoding", r.headers.get("content-encoding"))
    body = r.read()
print("raw prefix:", body[:40])
try:
    j = json.loads(body)
    print("json ok, url =", bool((j.get("data") or [{}])[0].get("url")))
except Exception as e:
    print("json 解析失败:", type(e).__name__, e)
    try:
        j = json.loads(gzip.decompress(body))
        print("gzip 解压后 ok, url =", bool((j.get("data") or [{}])[0].get("url")))
    except Exception as e2:
        print("gzip 也失败:", e2)
