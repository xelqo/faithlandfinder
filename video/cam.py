# Composite the talking head as a moving circle over the rendered visuals, with its audio.
# python3 cam.py visuals.mp4 out.mp4
import json, subprocess, sys
from PIL import Image, ImageDraw
vis, out = sys.argv[1], sys.argv[2]
T = json.load(open("timing.json"))
S = 860                       # crop size from the 1080x1920 talking head (face centred)
CROP = f"crop={S}:{S}:110:330"
m = Image.new("L", (S, S), 0); ImageDraw.Draw(m).ellipse((0, 0, S - 1, S - 1), fill=255); m.save("raw/mask.png")
r = Image.new("RGBA", (S, S), (0, 0, 0, 0)); ImageDraw.Draw(r).ellipse((0, 0, S - 1, S - 1), outline=(255, 255, 255, 255), width=22); r.save("raw/ring.png")

# (time, centre x, centre y, diameter): where the bubble sits for each scene
K = [(0, 1530, 540, 560), (T["s2"], 200, 860, 300), (T["s3"], 190, 190, 280), (T["s4"], 1450, 520, 600), (T["tag"], 1700, 880, 260)]
TR = 0.6
def expr(i):
    parts = []
    for j in range(1, len(K)):
        t1, a, b = K[j][0], K[j - 1][i], K[j][i]
        parts.append((t1 - TR / 2, t1 + TR / 2, a, b))
    e = str(K[-1][i])
    for (ta, tb, a, b) in reversed(parts):
        x = f"((t-{ta:.3f})/{TR})"
        e = f"if(lt(t,{tb:.3f}),{a}+({b}-{a})*{x}*{x}*(3-2*{x}),{e})"
        e = f"if(lt(t,{ta:.3f}),{a},{e})"
    return e
X, Y, D = expr(1), expr(2), expr(3)
fc = (f"[1:v]{CROP},setpts=PTS-STARTPTS,format=yuva420p[c];[2:v]format=gray[m];[c][m]alphamerge[ca];"
      f"[ca][3:v]overlay=0:0[cr];[cr]scale=w='trunc(({D})/2)*2':h='trunc(({D})/2)*2':eval=frame[cs];"
      f"[0:v][cs]overlay=x='({X})-w/2':y='({Y})-h/2':eval=frame:shortest=0[v];"
      f"[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,apad[a]")
open("raw/fc.txt", "w").write(fc)
cmd = ["ffmpeg", "-v", "error", "-y", "-i", vis, "-i", "raw/cam.mov", "-loop", "1", "-i", "raw/mask.png", "-loop", "1", "-i", "raw/ring.png",
       "-/filter_complex", "raw/fc.txt", "-map", "[v]", "-map", "[a]", "-t", str(T["end"]),
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", out]
subprocess.run(cmd, check=True)
print("wrote", out)
