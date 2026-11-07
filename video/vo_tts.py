# Draft voiceover with macOS `say`, one clip per scene; scene start times follow the clips.
# python3 vo_tts.py [voice] [rate]  ->  vo/vo.m4a + timing.json
import re, subprocess, sys, json, os
voice = sys.argv[1] if len(sys.argv) > 1 else "Samantha"
rate = sys.argv[2] if len(sys.argv) > 2 else "178"
text = open("voiceover.md").read().split("---")[0]
blocks = [b.strip() for b in re.split(r"\*\*\[[^\]]+\]\*\*", text)[1:]]
assert len(blocks) == 4, len(blocks)
MIN = [5.5, 17.0, 12.5, 7.0]   # shortest each scene's animation can be
os.makedirs("vo", exist_ok=True)
starts, t, files = [], 0.4, []
for i, b in enumerate(blocks):
    f = f"vo/{i}.aiff"
    subprocess.run(["say", "-v", voice, "-r", rate, "-o", f, b.replace("SB 4", "S B 4")], check=True)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
    starts.append(t); files.append(f)
    t = t + max(MIN[i], d + 0.6)
    print(i, round(d, 2), "s")
end = t + 0.5
names = ["s1", "s2", "s3", "s4"]
timing = {n: round(s - 0.4, 2) for n, s in zip(names, starts) if n != "s1"}
timing["end"] = round(end, 2)
json.dump(timing, open("timing.json", "w"))
inputs = sum([["-i", f] for f in files], [])
delays = ";".join(f"[{i}]adelay={int(s*1000)}|{int(s*1000)}[a{i}]" for i, s in enumerate(starts))
mix = "".join(f"[a{i}]" for i in range(len(files))) + f"amix=inputs={len(files)}:normalize=0,apad,atrim=0:{end}[out]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", delays + ";" + mix, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "vo/vo.m4a"], check=True)
print("timing", timing)
