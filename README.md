# Faith Land Finder

> For a small housing nonprofit with no GIS team: finds church land in Orange County that SB 4 now lets
> become 100% affordable homes, checks each site against the law's tests with sources, and writes the
> first-conversation brief for the congregation.

**Team:** [team name]
**Members:** Alex Tsai
**Lane:** 1 Find it
**Built at:** Claude Impact Lab: UCI × SoCal Affordable Housing, November 7, 2026

## The real user

A one-person acquisitions team at a small housing nonprofit (Lane 1 scenario F02, made up): *"Give me ten
sites in one city I should call about this month, and why each one."* Since 2024, SB 4 lets churches build
100% affordable housing by right, but there is no public layer of church-owned land, and each site needs
several map layers and a look at the lot before anyone picks up the phone.

**Before:** sites come by luck (a pastor calls), or by hours in five county and state map viewers per parcel,
then driving by to see if the "open land" is really a parking lot, a school yard or a cemetery.
**After:** a ranked list with an estimate of homes per site, pass / fail / unknown on each SB 4 test with a source
link, what the open land really is, how strong the ownership lead is, and a plain-language brief to bring to the
congregation's facilities chair (scenario F01). Any address can be checked live in about 20 seconds.

## What we built

- **Ranked list + map** of places of worship in the Santa Ana area (OpenStreetMap), matched to parcels.
- **Report card per site:** satellite image with the parcel outlined, homes estimate with the formula on screen,
  SB 4 site tests (fire, flood, landslide, slope, fault, ownership date), parking rule (transit), facts and sources.
- **Live check:** type any Orange County address and the whole pipeline runs on the spot.

**Demo video:** uploaded on the hub
**Live demo:** https://faithlandfinder.vercel.app

## How Claude is used

**Code does the facts, Claude does the judgment.** Every number comes from a public map service or a labelled
assumption; Claude is used only where code can't decide:

1. **Reads the satellite image:** what the unbuilt land inside the outline really is (striped parking, lawn,
   dirt, playground…) and red flags (a school or daycare on site, a cemetery, an odd shape). Example: at Calvary
   Church of Santa Ana it spotted school buses and a fenced turf yard and flagged a possible school.
2. **Judges the ownership proxy:** there is no free "religious owner" field, so Claude weighs the IRS nonprofit
   registry (via ProPublica), the tax mailing address and what the campus looks like (a storefront church in a
   strip mall is probably a renter). Always shown as a *lead*, never a fact.
3. **Writes the brief** for the congregation: what could fit, what they keep, what is still unknown, one next step.

Model: `claude-opus-5-5` with structured JSON output. A person should still check the unknowns it lists.
The app itself was built with Claude Code.

## Try it

Needs Node.js 20+.

```bash
git clone <this repo> && cd <repo>
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY to get Claude's read on live checks
npm run dev                 # open http://localhost:3000 (dev server: scripts/dev-server.js)
```

The ranked list works without a key (it ships in `public/sites.json`). Without a key, live checks still show
all the public-data facts, just no Claude read. To rebuild the list: `npm run precompute` (about 3 minutes, 15
Claude calls). Deploys to Vercel as-is; set `ANTHROPIC_API_KEY` in the project settings.

## Sources and assumptions

| Item | Source or assumption | Date checked |
|---|---|---|
| Places of worship | OpenStreetMap `amenity=place_of_worship` via Overpass (ODbL), `data/osm_worship.json` | Nov 6, 2026 |
| Parcels (Santa Ana: APN, site + mailing address) | City of Santa Ana GIS_AssessorParcels | Nov 7, 2026 |
| Parcels (rest of OC) | OC Public Works Parcels FeatureServer | Nov 7, 2026 |
| Buildings | OC Building Footprints | Nov 7, 2026 |
| Zoning, slope | SCAG Zoning_poly_OR | Nov 7, 2026 |
| Fire hazard zones | OC Fire_Hazard_Severity_Zones_LRA | Nov 7, 2026 |
| Flood zones | OC Floodplains (FEMA DFIRM copy) | Nov 7, 2026 |
| Landslide zones | CGS Landslide Zones | Nov 7, 2026 |
| Transit (parking rule) | Caltrans High Quality Transit Areas | Nov 7, 2026 |
| Satellite imagery | Esri World Imagery | Nov 7, 2026 |
| Religious nonprofits | ProPublica Nonprofit Explorer API (IRS data) | Nov 7, 2026 |
| Address lookup | US Census Geocoder | Nov 7, 2026 |
| SB 4 rules | Gov Code 65913.16; HCD SB 4 fact sheet (`data/hcd_sb4.pdf`): 100% affordable, by right, land owned by a religious institution before Jan 1 2024, ≤1 parking space per home (0 near transit). Site exclusions via Gov Code 65913.4(a)(6) (fire, flood, fault zones and more): **check the exact exceptions in the statute** | Nov 6, 2026 |
| Parking kept for worship | AB 2244 (2022): up to 50% of religious-use parking can be removed for housing | Nov 6, 2026 |
| Density | SB 4: 30 homes/acre in residential zones in a metro county, 40 in non-residential zones. When the zone type is unclear we use 30 | Nov 6, 2026 |
| Share of open land used | **ASSUMPTION: 50%**. The rest stays parking and space for the congregation | |
| Open land | Lot area minus building footprints (buildings counted if their centre is inside the parcel) | |
| Diocese mailing address | 13280 Chapman Ave, Garden Grove = Roman Catholic Diocese of Orange (Christ Cathedral campus); used as an ownership hint | Nov 7, 2026 |

## What is real and what is mocked

| Part | Status |
|---|---|
| Parcel, buildings, zoning, fire, flood, landslide, transit lookups | working, live public data |
| Satellite read, ownership lead, brief (Claude) | working |
| Homes estimate | working, but an estimate (50% share and density are assumptions) |
| Earthquake fault zone test | not automated: no open service found, shown as "unknown" with a link |
| Owned before Jan 1 2024 | not automated: needs the Assessor roll (not free), shown as "unknown" |
| City objective standards (setbacks, height) | not covered |
| Area covered by the ranked list | Santa Ana area only (live check works anywhere in OC) |

## Where it gets things wrong

- Ownership is a proxy. The IRS registry search is by name and misses many congregations; a match does not
  prove the parcel is owned by that congregation.
- OSM points can land on the wrong parcel (e.g. a neighbouring lot), and some churches share a parcel with a school.
- "Open land" includes trees, walkways and setbacks; Claude's land breakdown helps, but the 50% share is rough.
- Zoning codes like specific-plan districts (e.g. Santa Ana `SD95`) don't say residential or not, so density is
  uncertain.
- Fire and flood exclusions in the statute have exceptions we don't model.

## Next steps

- Add the Assessor roll (owner type + acquisition date) to turn leads into facts.
- Fault zones and the full SB 4 exclusion list; one city's objective standards done well.
- Every OC city, not just Santa Ana; export a call list for the acquisitions lead.
- Sit with a nonprofit and one congregation and test the brief.

## Data and privacy

This project uses only public data. It contains no personal information about real tenants, buyers or
residents. Sites are institutions (places of worship), and unnamed or person-named map points are left out.
It does not file applications or contact any city or person.

## Other work in this repo

`experiments/fire-ready/` is an earlier idea from the same day (a wildfire-insurance photo checklist) that we
dropped because it didn't help get homes built.

## License

MIT, see [LICENSE](LICENSE).
