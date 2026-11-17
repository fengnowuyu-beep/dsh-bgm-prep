import io, json, sys, urllib.request
import numpy as np, torch
from transformers import ClapModel, ClapProcessor

job = json.load(sys.stdin)
url = job["url"]
req = urllib.request.Request(url, headers={"user-agent":"Mozilla/5.0","referer":"https://music.163.com/"})
raw = urllib.request.urlopen(req, timeout=60).read()
import librosa
y, sr = librosa.load(io.BytesIO(raw), sr=48000, mono=True, duration=45)
mid = max(0, (len(y) - sr*30)//2)
clip = y[mid:mid+sr*30]

model = ClapModel.from_pretrained("laion/larger_clap_music_and_speech").eval()
proc = ClapProcessor.from_pretrained("laion/larger_clap_music_and_speech")
scale = model.logit_scale_a.exp().item()

def embed_texts(texts):
    with torch.no_grad():
        e = model.get_text_features(**proc(text=texts, return_tensors="pt", padding=True))
        e = e if torch.is_tensor(e) else e.pooler_output
        return e / e.norm(dim=-1, keepdim=True)

def embed_audio(clip):
    with torch.no_grad():
        e = model.get_audio_features(**proc(audio=clip, sampling_rate=48000, return_tensors="pt"))
        e = e if torch.is_tensor(e) else e.pooler_output
        return e / e.norm(dim=-1, keepdim=True)

# 旧：每个概念一个句子
OLD = ["calm gentle piano music","feel-good upbeat music","sad melancholic music","tense suspenseful music","groovy rhythmic dance music"]
# 新：每个概念 4 个说法，向量取平均
NEW = {
 "安静钢琴": ["calm gentle piano music","solo piano ballad","soft contemplative piano"],
 "轻快":     ["feel-good upbeat music","cheerful playful acoustic guitar","bouncy light-hearted folk tune","happy accordion and strings","bright lively instrumental"],
 "忧伤":     ["sad melancholic music","mournful slow strings","wistful lonely piano"],
 "紧张悬疑": ["tense suspenseful music","eerie creeping atmosphere"],
 "律动":     ["groovy rhythmic dance music","upbeat rhythmic percussion"],
}
a = embed_audio(clip)
for name, set_ in (("旧（单句）", [(k,[k]) for k in OLD]), ("新（多句平均）", list(NEW.items()))):
    # group name -> text
    pass

# 旧：直接把英文句子当标签
labels_old = ["安静钢琴","轻快","忧伤","紧张悬疑","律动"]
probs_old = ((a @ embed_texts(OLD).T).squeeze(0) * scale).softmax(-1).tolist()
print("== 旧（每概念 1 句）==")
for l, p in sorted(zip(labels_old, probs_old), key=lambda x: -x[1]):
    print(f"  {l}: {p:.3f}")

# 新：每概念多句，先各自归一化再平均
centers = []
names = []
for name, texts in NEW.items():
    e = embed_texts(texts).mean(dim=0)
    e = e / e.norm()
    centers.append(e); names.append(name)
mat = torch.stack(centers)
probs_new = ((a @ mat.T).squeeze(0) * scale).softmax(-1).tolist()
print("== 新（每概念 3-5 句平均）==")
for l, p in sorted(zip(names, probs_new), key=lambda x: -x[1]):
    print(f"  {l}: {p:.3f}")
