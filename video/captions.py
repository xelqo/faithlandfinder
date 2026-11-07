# From the edited talking head's word timings -> assets/captions.json (2-3 word chunks) + timing.json (scene starts).
import json, re
W = json.load(open("raw/cam_words.json"))
# join split tokens, fix Whisper's mishearings (what was meant on screen)
FIX = {"medium": "median", "$1": "$1.47", ".47": None, "non": "nonprofit", "-profit": None, "FaithFinder": "Faith Land Finder",
       "Interior": "Enter a", "record,": "records,", "test.": "tests.", "100": "100%", "%": None, "home,": "home", "I": "might"}
words = []
for i, w in enumerate(W):
    t = w["w"]
    if t in FIX:
        if FIX[t] is None:
            words[-1]["e"] = w["e"]; continue
        if t == "I" and not (i + 1 < len(W) and W[i + 1]["w"] == "already"): pass
        else: t = FIX[t]
    words.append({"w": t, "s": w["s"], "e": w["e"]})
caps, cur = [], []
for i, w in enumerate(words):
    cur.append(w)
    nxt = words[i + 1] if i + 1 < len(words) else None
    end = re.search(r"[.,!?:]$", w["w"]) or len(cur) >= 3 or (nxt and nxt["s"] - w["e"] > 0.35) or not nxt
    if end:
        caps.append({"t0": round(cur[0]["s"], 2), "t1": round(w["e"], 2), "text": " ".join(x["w"] for x in cur)}); cur = []
merged = []
for c in caps:  # fold one-word leftovers ("million.", "map.") into the chunk before
    if merged and len(c["text"].split()) == 1 and not re.search(r"[.!?]$", merged[-1]["text"]) and len(merged[-1]["text"].split()) <= 3:
        merged[-1]["text"] += " " + c["text"]; merged[-1]["t1"] = c["t1"]
    else:
        merged.append(c)
caps = merged
for c in caps: c["text"] = c["text"].replace("Church's", "church's")
for a, b in zip(caps, caps[1:]):  # no flicker between chunks
    if b["t0"] - a["t1"] < 0.5: a["t1"] = b["t0"]
json.dump(caps, open("assets/captions.json", "w"), indent=0)

def start_of(word, nth=1, after=0):
    k = 0
    for w in words:
        if w["s"] >= after and w["w"].strip(",.").lower() == word.lower():
            k += 1
            if k == nth: return w["s"]
    raise SystemExit(f"not found: {word}")
s2 = start_of("Look"); s3 = start_of("Faith Land Finder"); eleven = start_of("11"); s4 = max(w["s"] for w in words if w["w"] == "In" and w["s"] < eleven)
end = words[-1]["e"] + 3.0
tag = max(w["s"] for w in words if w["w"] == "And")
timing = {"tag": round(tag - 0.1, 2), "s2": round(s2 - 0.15, 2), "s3": round(s3 - 0.15, 2), "s4": round(s4 - 0.15, 2), "end": round(end, 2), "voice_end": round(words[-1]["e"], 2)}
json.dump(timing, open("timing.json", "w"))
print(timing); print(len(caps), "captions"); print(" | ".join(c["text"] for c in caps))
