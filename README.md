# Fire-Ready

Snap photos of your home. Claude checks them against California's "Safer from Wildfires" insurance discount list
and tells you what to fix, what's done, and what to show your insurer.

- Claude only describes what it sees per check; `rules.yaml` decides pass / fail / unsure (e.g. vents and windows
  can never "pass" from a photo alone).
- Sources for every rule: `SOURCES.md`.

## Run
```
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env   # without a key the app returns demo answers
npm run dev                                   # prints a URL to open on your phone (same Wi-Fi)
```
Deploys to Vercel as-is (`public/` + `api/`); set `ANTHROPIC_API_KEY` in the Vercel project settings.
