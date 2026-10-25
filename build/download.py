"""Download every raw input (cached; safe to re-run).

Usage: python -I download.py <raw_dir>
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with python -I
from config import STATES

RAW = sys.argv[1]
CB = "https://www2.census.gov/geo/tiger/GENZ2024/shp/"
ACS = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-{}.dat"
PL = "https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/{}/{}2020.pl.zip"
DV = "https://dataverse.harvard.edu/api/access/datafile/{}"
ZILLOW = "https://files.zillowstatic.com/research/public_csvs/"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]

files = {
    "acs_b03002.dat": ACS.format("b03002"), "acs_b19013.dat": ACS.format("b19013"),
    "acs_b25077.dat": ACS.format("b25077"), "acs_b25064.dat": ACS.format("b25064"),
    "elec_tracts_2024.tab": DV.format(14308848),   # imperviousness method, census tracts
    "elec_bg_2024.tab": DV.format(14308849),       # imperviousness method, block groups
    "zillow_zhvi_zip.csv": ZILLOW + "zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "zillow_zori_zip.csv": ZILLOW + "zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
    "cb_2024_us_county_500k.zip": CB + "cb_2024_us_county_500k.zip",
    "tl_2024_us_state.zip": "https://www2.census.gov/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip",  # legal (unclipped) state lines
    "cb_2020_us_zcta520_500k.zip": "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip",
    "zcta_county_rel.txt": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
}
for st, (ab, name, _) in STATES.items():
    files[f"{ab}2020.pl.zip"] = PL.format(name, ab)
    files[f"tl_2020_{st}_tabblock20.zip"] = f"https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_{st}_tabblock20.zip"
    for layer in ["tract", "place", "cousub"]:
        files[f"cb_2024_{st}_{layer}_500k.zip"] = f"{CB}cb_2024_{st}_{layer}_500k.zip"


def get(item):
    name, url = item
    path = os.path.join(RAW, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return f"cached {name}"
    for attempt in range(3):
        try:
            with requests.get(url, stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(path + ".part", "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            os.replace(path + ".part", path)
            return f"got {name} {os.path.getsize(path) / 1e6:.0f} MB"
        except Exception as e:  # noqa: BLE001 - retry any network error
            err = e
            time.sleep(5)
    return f"FAILED {name}: {err}"


def neighborhoods(st):
    """OpenStreetMap neighborhood names (for tract labels and search)."""
    ab = STATES[st][0]
    path = os.path.join(RAW, f"osm_{ab}.json")
    if os.path.exists(path):
        return f"cached osm_{ab}"
    q = (f'[out:json][timeout:300];area["ISO3166-2"="US-{ab.upper()}"]->.a;'
         'nwr["place"~"^(neighbourhood|suburb|quarter)$"]["name"](area.a);out center tags;')
    for url in OVERPASS * 2:
        try:
            r = requests.post(url, data={"data": q}, timeout=400,
                              headers={"User-Agent": "neighborhood-explorer/1.0 (personal research map)"})
            r.raise_for_status()
            els = r.json()["elements"]
            out = [{"name": e["tags"]["name"], "lat": e.get("lat", e.get("center", {}).get("lat")),
                    "lon": e.get("lon", e.get("center", {}).get("lon"))} for e in els]
            json.dump([o for o in out if o["lat"]], open(path, "w"))
            return f"got osm_{ab}: {len(out)} names"
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(45)
    return f"FAILED osm_{ab}: {err}"


if __name__ == "__main__":
    os.makedirs(RAW, exist_ok=True)
    with ThreadPoolExecutor(6) as ex:
        for msg in ex.map(get, files.items()):
            print(msg, flush=True)
    for st in STATES:  # Overpass allows few parallel requests
        print(neighborhoods(st), flush=True)
