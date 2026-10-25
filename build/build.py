"""Build the map data for each region tab.

Usage: python -I build.py <raw_dir> <data_dir> [region ...]
Run download.py first. Outputs data/<region>/... plus data/regions.json.
"""
import json, os, sys, time, zipfile

import numpy as np
import pandas as pd
import geopandas as gpd
import shapely

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with python -I
from config import STATES, REGIONS, DOTS_PER_PERSON_DETAIL, DOTS_PER_PERSON_OVERVIEW, SEED

RAW, OUT = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3:] or list(REGIONS)
OUR = set(STATES)
TOWN_STATES = {"09", "34"}  # towns/townships (county subdivisions) are the real local governments here
VOTES = ["votes_dem", "votes_rep", "votes_total"]
FIELDS = ["pop", "white", "black", "hispanic", "asian", "other", "income", "homeval", "rent", "margin", "dem", "rep", "votes_total"]
rng = np.random.default_rng(SEED)
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.0f}s]", *a, flush=True)


# ---------------------------------------------------------------- shared inputs
def num(s):
    v = pd.to_numeric(s, errors="coerce")
    return v.where(v >= 0)  # negative values are Census missing-data codes


def load_acs():
    """ACS 2020-24 5-year for tracts (t:), counties (c:), places (p:), county subdivisions (s:)."""
    sumlev = {"140": "t", "050": "c", "160": "p", "060": "s"}

    def table(name, cols):
        df = pd.read_csv(f"{RAW}/acs_{name}.dat", sep="|", dtype=str, usecols=["GEO_ID"] + cols)
        df = df[df.GEO_ID.str[:3].isin(sumlev) & (df.GEO_ID.str[3:7] == "0000") & df.GEO_ID.str[9:11].isin(OUR)]
        df.index = df.GEO_ID.str[:3].map(sumlev) + ":" + df.GEO_ID.str[9:]
        return df.drop(columns="GEO_ID").apply(num)

    r = table("b03002", [f"B03002_E{n:03d}" for n in (1, 3, 4, 5, 6, 7, 8, 9, 12)])
    tot = r.B03002_E001.where(r.B03002_E001 > 0)
    s = pd.DataFrame({
        "pop": r.B03002_E001, "white": r.B03002_E003 / tot, "black": r.B03002_E004 / tot,
        "hispanic": r.B03002_E012 / tot, "asian": r.B03002_E006 / tot,
        "other": (r.B03002_E005 + r.B03002_E007 + r.B03002_E008 + r.B03002_E009) / tot})
    s["income"] = table("b19013", ["B19013_E001"]).iloc[:, 0]
    s["homeval"] = table("b25077", ["B25077_E001"]).iloc[:, 0]
    s["rent"] = table("b25064", ["B25064_E001"]).iloc[:, 0]
    return s


def load_votes():
    el = pd.read_csv(f"{RAW}/elec_tracts_2024.tab", sep="\t", dtype={"tract_GEOID": str}, usecols=["tract_GEOID"] + VOTES)
    el = el[el.tract_GEOID.str[:2].isin(OUR)].set_index("tract_GEOID")
    v = pd.concat([el.rename(index=lambda g: "t:" + g),
                   el.groupby(el.index.str[:5]).sum().rename(index=lambda g: "c:" + g)])
    bg = pd.read_csv(f"{RAW}/elec_bg_2024.tab", sep="\t", dtype={"bg_GEOID": str}, usecols=["bg_GEOID"] + VOTES)
    return v, bg[bg.bg_GEOID.str[:2].isin(OUR)].set_index("bg_GEOID")


def load_zillow(name):
    head = pd.read_csv(f"{RAW}/{name}", nrows=0).columns
    dates = [c for c in head if c[:2] == "20"]
    z = pd.read_csv(f"{RAW}/{name}", dtype={"RegionName": str}, usecols=["RegionName", dates[-13], dates[-1]])
    z.index = z.RegionName.str.zfill(5)
    return z[dates[-1]], z[dates[-13]], dates[-1]


def load_zcta(zhvi, zhvi_ly, zori):
    rel = pd.read_csv(f"{RAW}/zcta_county_rel.txt", sep="|", dtype=str, encoding="utf-8-sig",
                      usecols=["GEOID_ZCTA5_20", "GEOID_COUNTY_20", "AREALAND_PART"]).dropna()
    rel = rel[(rel.AREALAND_PART.astype(float) > 0) & rel.GEOID_COUNTY_20.str[:2].isin(OUR)]
    zst = rel.groupby("GEOID_ZCTA5_20").GEOID_COUNTY_20.agg(lambda s: sorted(set(s.str[:2])))
    z = gpd.read_file(f"{RAW}/cb_2020_us_zcta520_500k.zip", columns=["GEOID20"]).to_crs(4326)
    z = z[z.GEOID20.isin(zst.index)].rename(columns={"GEOID20": "zip"}).reset_index(drop=True)
    z["states"] = z.zip.map(zst)
    z["zhvi"] = z.zip.map(zhvi)
    z["zhvi_chg"] = z.zip.map(zhvi / zhvi_ly - 1)
    z["zori"] = z.zip.map(zori)
    return z


# ---------------------------------------------------------------- helpers
def finalize(df):
    """Add vote shares/margin and round for output."""
    df = df.copy()
    tv = df.votes_total.where(df.votes_total > 0)
    df["margin"] = (df.votes_dem - df.votes_rep) / tv
    df["dem"], df["rep"] = df.votes_dem / tv, df.votes_rep / tv
    for c in ["white", "black", "hispanic", "asian", "other", "margin", "dem", "rep"]:
        df[c] = df[c].round(3)
    for c in ["pop", "income", "homeval", "rent", "votes_total"]:
        df[c] = df[c].round(0)
    return df


def records(df, cols):
    out = []
    for rec in df[cols].to_dict("records"):
        out.append({k: (None if (isinstance(v, float) and np.isnan(v)) else
                        int(v) if isinstance(v, float) and v.is_integer() and abs(v) >= 1 else
                        float(v) if isinstance(v, (float, np.floating)) else v) for k, v in rec.items()})
    return out


def write_geojson(path, gdf, cols, simplify=0.0):
    geoms = gdf.geometry.values
    if simplify:
        geoms = shapely.simplify(geoms, simplify, preserve_topology=True)
    geoms = shapely.transform(geoms, lambda c: np.round(c, 5))
    gj = shapely.to_geojson(geoms)
    props = records(pd.DataFrame(gdf.drop(columns="geometry")), cols)
    with open(path, "w", encoding="utf-8") as f:
        f.write('{"type":"FeatureCollection","features":[')
        f.write(",".join(f'{{"type":"Feature","properties":{json.dumps(p, separators=(",", ":"))},"geometry":{g}}}'
                         for p, g in zip(props, gj)))
        f.write("]}")
    return os.path.getsize(path) / 1e6


def sample_points(geoms, counts):
    """Uniform random points inside polygons (counts[i] points in geoms[i]); vectorized rejection sampling.
    Returns x, y ordered by polygon."""
    n = len(geoms)
    shapely.prepare(geoms)
    b = shapely.bounds(geoms)
    fill = np.clip(shapely.area(geoms) / np.maximum((b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1]), 1e-18), 0.02, 1)
    need = counts.astype(np.int64).copy()
    oi, ox, oy = [], [], []
    for _ in range(8):
        todo = np.nonzero(need > 0)[0]
        if not len(todo):
            break
        m = np.ceil(need[todo] / fill[todo] * 1.3).astype(np.int64) + 2
        idx = np.repeat(todo, m)
        x = b[idx, 0] + rng.random(len(idx)) * (b[idx, 2] - b[idx, 0])
        y = b[idx, 1] + rng.random(len(idx)) * (b[idx, 3] - b[idx, 1])
        ok = shapely.contains_xy(geoms[idx], x, y)
        idx, x, y = idx[ok], x[ok], y[ok]
        rank = np.arange(len(idx)) - np.searchsorted(idx, idx, side="left")
        keep = rank < need[idx]
        idx, x, y = idx[keep], x[keep], y[keep]
        need -= np.bincount(idx, minlength=n)
        oi.append(idx); ox.append(x); oy.append(y)
    todo = np.nonzero(need > 0)[0]
    if len(todo):  # slivers: fall back to a point on the surface
        p = shapely.point_on_surface(geoms[todo])
        oi.append(np.repeat(todo, need[todo]))
        ox.append(np.repeat(shapely.get_x(p), need[todo])); oy.append(np.repeat(shapely.get_y(p), need[todo]))
    i, x, y = np.concatenate(oi), np.concatenate(ox), np.concatenate(oy)
    o = np.argsort(i, kind="stable")
    return x[o], y[o]


def write_dots(path, x, y, g):
    """Binary: uint16 x,y pairs quantized to the bbox, then uint8 race group."""
    bb = [float(x.min()), float(y.min()), float(x.max()), float(y.max())]
    sx, sy = max(bb[2] - bb[0], 1e-9), max(bb[3] - bb[1], 1e-9)
    q = np.empty(2 * len(x), np.uint16)
    q[0::2] = np.round((x - bb[0]) / sx * 65535)
    q[1::2] = np.round((y - bb[1]) / sy * 65535)
    with open(path, "wb") as f:
        f.write(q.tobytes()); f.write(g.astype(np.uint8).tobytes())
    return [round(v, 6) for v in bb]


def load_pl(st):
    """2020 Census P.L. 94-171 block records: geography codes + race/ethnicity (table P2)."""
    ab = STATES[st][0]
    z = zipfile.ZipFile(f"{RAW}/{ab}2020.pl.zip")
    geo = pd.read_csv(z.open(f"{ab}geo2020.pl"), sep="|", header=None, dtype=str, encoding="latin-1",
                      usecols=[2, 7, 9, 14, 17, 29, 32, 33])
    geo.columns = ["sumlev", "logrecno", "geocode", "county", "cousub", "place", "tract", "bg"]
    geo = geo[geo.sumlev == "750"].drop(columns="sumlev")
    seg = pd.read_csv(z.open(f"{ab}000012020.pl"), sep="|", header=None, dtype=str, usecols=[4, 5] + list(range(76, 87)))
    seg.columns = ["logrecno", "P1_001"] + [f"P2_{i:03d}" for i in range(1, 12)]
    b = geo.merge(seg, on="logrecno").drop(columns="logrecno")
    pc = [c for c in b.columns if c[:2] in ("P1", "P2")]
    b[pc] = b[pc].astype(np.int32)
    assert (b.P1_001 == b.P2_001).all(), "P2 column offset wrong"
    b["G0"], b["G1"], b["G2"], b["G3"] = b.P2_005, b.P2_006, b.P2_002, b.P2_008  # White, Black, Hispanic, Asian (non-Hispanic)
    b["G4"] = b.P2_007 + b.P2_009 + b.P2_010 + b.P2_011                          # other / multiracial
    return b.drop(columns=[c for c in pc if c != "P1_001"]).set_index("geocode")


# ---------------------------------------------------------------- per state
def build_state(st, rid, S, V, BGV, OSM, manifest, overview):
    ab, _, sname = STATES[st]
    log(f"{ab}: tracts + blocks")
    tracts = gpd.read_file(f"{RAW}/cb_2024_{st}_tract_500k.zip").to_crs(4326)
    places = gpd.read_file(f"{RAW}/cb_2024_{st}_place_500k.zip").to_crs(4326)
    cousubs = gpd.read_file(f"{RAW}/cb_2024_{st}_cousub_500k.zip").to_crs(4326)
    counties = COUNTY[COUNTY.STATEFP == st]
    b = load_pl(st)
    if st == "09":  # 2020 blocks use old CT counties; ACS/votes use 2022 planning regions (tract codes unchanged)
        b["county"] = b.tract.map(dict(zip(tracts.TRACTCE, tracts.COUNTYFP))).fillna(b.county)
    b["tract11"] = st + b.county + b.tract
    b["bg12"] = b.tract11 + b.bg

    # votes: block groups -> blocks (by population) -> places and towns
    pop = b.P1_001.astype(float)
    bgpop = pop.groupby(b.bg12).transform("sum")
    share = np.where(bgpop > 0, pop / bgpop.where(bgpop > 0, 1), 0)
    bv = pd.DataFrame(BGV.reindex(b.bg12.values)[VOTES].fillna(0).to_numpy() * share[:, None], columns=VOTES, index=b.index)
    has_place = b.place != "99999"
    pv = bv[has_place].groupby(st + b.place[has_place]).sum().rename(index=lambda g: "p:" + g)
    has_town = ~b.cousub.isin(["99999", "00000"])
    town_id = st + b.county + b.cousub
    sv = bv[has_town].groupby(town_id[has_town]).sum().rename(index=lambda g: "s:" + g)
    votes = pd.concat([V, pv, sv])

    # tract label: OSM neighborhood inside the tract, else majority town/place, else county
    unit_id = town_id if st in TOWN_STATES else st + b.place
    unit_ok = has_town if st in TOWN_STATES else has_place
    unit_names = (dict(zip(cousubs.GEOID, cousubs.NAME)) if st in TOWN_STATES else dict(zip(places.GEOID, places.NAME)))
    maj = (pd.DataFrame({"t": b.tract11[unit_ok], "u": unit_id[unit_ok], "p": b.P1_001[unit_ok]})
           .groupby(["t", "u"]).p.sum().reset_index().sort_values("p").drop_duplicates("t", keep="last"))
    town_of = dict(zip(maj.t, maj.u.map(unit_names)))

    tracts["rep"] = tracts.geometry.representative_point()
    nb = OSM.get(st)
    nb_of, nb_rows = {}, []
    if nb is not None and len(nb):
        j = gpd.sjoin(nb, tracts[["GEOID", "geometry"]], predicate="within")
        rp = tracts.set_index("GEOID").rep
        j["d"] = [p.distance(rp[g]) for p, g in zip(j.geometry, j.GEOID)]
        best = j.sort_values("d").drop_duplicates("GEOID")
        nb_of = dict(zip(best.GEOID, best.name))
        nb_rows = list(zip(j.name, j.geometry.x, j.geometry.y, j.GEOID))

    zj = gpd.sjoin(gpd.GeoDataFrame(tracts[["GEOID"]], geometry=tracts.rep, crs=4326), ZCTA[["zip", "geometry"]], predicate="within")
    zip_of = dict(zip(zj.GEOID, zj.zip))

    cname = dict(zip(counties.GEOID, counties.NAMELSAD))
    t = tracts[["GEOID", "NAME", "geometry"]].rename(columns={"GEOID": "id", "NAME": "tract"})
    t["county"] = t.id.str[:5].map(cname) + ", " + ab.upper()
    t["town"] = t.id.map(town_of)
    t["label"] = t.id.map(nb_of).fillna(t.town).fillna(t.id.str[:5].map(cname))
    t["zip"] = t.id.map(zip_of)
    st_stats = finalize(S.reindex("t:" + t.id).join(votes.reindex("t:" + t.id)).set_axis(t.index))
    t = t.join(st_stats)

    # entities: counties, places, and (CT/NJ) towns
    ents = []
    for kind, gdf, typ in [("c", counties, None), ("p", places, None), ("s", cousubs if st in TOWN_STATES else None, None)]:
        if gdf is None:
            continue
        e = gpd.GeoDataFrame({"id": kind + ":" + gdf.GEOID.values,
                              "name": (gdf.NAMELSAD if kind == "c" else gdf.NAME).values + ", " + ab.upper(),
                              "type": "county" if kind == "c" else [n[len(m):].strip() for n, m in zip(gdf.NAMELSAD, gdf.NAME)]},
                             geometry=gdf.geometry.values, crs=4326)
        if kind == "c":
            e["type"] = [("city" if "city" in n.lower() else "county") if st != "11" else "district" for n in gdf.NAMELSAD]
        e = e.join(finalize(S.reindex(e.id).join(votes.reindex(e.id))).set_axis(e.index))
        ents.append(e[e["pop"].fillna(0) > 0])
    ents = pd.concat(ents, ignore_index=True)

    # race dots, one file per county
    geo = gpd.read_file(f"{RAW}/tl_2020_{st}_tabblock20.zip", columns=["GEOID20", "POP20"])
    geo = geo[geo.POP20 > 0].reset_index(drop=True)
    grp = b.reindex(geo.GEOID20.values)
    G = grp[["G0", "G1", "G2", "G3", "G4"]].fillna(0).to_numpy(np.float64) / DOTS_PER_PERSON_DETAIL
    n_g = (np.floor(G) + (rng.random(G.shape) < G % 1)).astype(np.int64)
    chunk = (st + grp.county.fillna("000")).to_numpy()
    geoms = geo.geometry.values
    os.makedirs(f"{OUT}/{rid}/dots", exist_ok=True)
    ndots = 0
    for cid in np.unique(chunk):
        ix = np.nonzero(chunk == cid)[0]
        ng = n_g[ix]
        if ng.sum() == 0:
            continue
        x, y = sample_points(np.asarray(geoms[ix]), ng.sum(1))
        g = np.repeat(np.tile(np.arange(5), len(ix)), ng.ravel())
        p = rng.permutation(len(x))
        x, y, g = x[p], y[p], g[p]
        bb = write_dots(f"{OUT}/{rid}/dots/{cid}.bin", x, y, g)
        manifest.append({"id": cid, "name": cname.get(cid, cid), "n": int(len(x)), "bbox": bb})
        keep = rng.random(len(x)) < DOTS_PER_PERSON_DETAIL / DOTS_PER_PERSON_OVERVIEW
        overview.append((x[keep], y[keep], g[keep]))
        ndots += len(x)
    log(f"{ab}: {len(t)} tracts, {len(ents)} places/counties, {ndots:,} dots for {int(b.P1_001.sum()):,} people")

    # search: neighborhoods with context
    lab = dict(zip(t.id, t.town.fillna(t.county)))
    nbs = [[n, lab.get(g, ""), round(float(x), 5), round(float(y), 5)] for n, x, y, g in nb_rows]
    return t, ents, nbs


# ---------------------------------------------------------------- region
def bbox4(g):
    return [round(float(v), 4) for v in g.bounds]


def write_borders(rid, states):
    """State lines shared by a region state and any neighbor, from TIGER legal boundaries
    (not shoreline-clipped, so the VA-MD line follows the Potomac and crosses the Chesapeake)."""
    geo = STATE_TL.set_index("STATEFP")
    rows = []
    for s in states:
        for t, h in geo.geometry.items():
            if t == s or (t in states and t < s) or not geo.geometry[s].envelope.intersects(h.envelope):
                continue
            inter = geo.geometry[s].boundary.intersection(h.boundary)
            parts = [g for g in getattr(inter, "geoms", [inter]) if g.geom_type in ("LineString", "MultiLineString")]
            if parts:
                line = shapely.simplify(shapely.line_merge(shapely.union_all(parts)), 0.0001)
                if line.is_empty or line.length < 0.01:  # states that only touch at a corner
                    continue
                rows.append({"pair": f"{geo.STUSPS[s]}–{geo.STUSPS[t]}", "geometry": line})
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs=4326)
    log(f"{rid}: state borders {', '.join(gdf.pair)}")
    return write_geojson(f"{OUT}/{rid}/borders.geojson", gdf, ["pair"])


def build_region(rid, S, V, BGV, OSM):
    R = REGIONS[rid]
    os.makedirs(f"{OUT}/{rid}", exist_ok=True)
    manifest, overview, T, E, NB = [], [], [], [], []
    for st in R["states"]:
        t, e, nb = build_state(st, rid, S, V, BGV, OSM, manifest, overview)
        T.append(t); E.append(e); NB += nb
    T = pd.concat(T, ignore_index=True); E = pd.concat(E, ignore_index=True)
    Z = ZCTA[ZCTA.states.apply(lambda s: bool(set(s) & set(R["states"])))].reset_index(drop=True)

    tcols = ["id", "tract", "label", "county", "town", "zip"] + FIELDS
    sizes = {
        "tracts": write_geojson(f"{OUT}/{rid}/tracts.geojson", T, tcols),
        "places": write_geojson(f"{OUT}/{rid}/places.geojson", E, ["id", "name", "type"] + FIELDS, simplify=0.0002),
        "zips": write_geojson(f"{OUT}/{rid}/zips.geojson", Z.assign(zhvi_chg=Z.zhvi_chg.round(4), zhvi=Z.zhvi.round(0), zori=Z.zori.round(0)),
                              ["zip", "zhvi", "zhvi_chg", "zori"], simplify=0.0002),
    }
    if len(R["states"]) > 1:  # single-state tabs don't need state lines
        sizes["borders"] = write_borders(rid, R["states"])
    x = np.concatenate([o[0] for o in overview]); y = np.concatenate([o[1] for o in overview]); g = np.concatenate([o[2] for o in overview])
    p = rng.permutation(len(x))
    ov = {"n": int(len(x)), "bbox": write_dots(f"{OUT}/{rid}/dots/overview.bin", x[p], y[p], g[p])}
    json.dump({"overview": ov, "chunks": manifest}, open(f"{OUT}/{rid}/dots/manifest.json", "w"), separators=(",", ":"))

    search = ([[r.name, r.type, r.id] + bbox4(r.geometry) for r in E.itertuples()] +
              [[f"ZIP {r.zip}", "ZIP code", "z:" + r.zip] + bbox4(r.geometry) for r in Z.itertuples()])
    seen, nbs = set(), []
    for n, ctx, lon, lat in NB:
        if (n, ctx) not in seen:
            seen.add((n, ctx)); nbs.append([n, ctx, lon, lat])
    json.dump({"areas": search, "neighborhoods": nbs}, open(f"{OUT}/{rid}/search.json", "w", encoding="utf-8"), separators=(",", ":"))

    # QA: tract votes vs county totals, population covered by dots
    log(f"{rid}: files MB {sizes}; overview dots {ov['n']:,}; search {len(search)} areas, {len(nbs)} neighborhoods")
    log(f"{rid}: tracts with income {T.income.notna().mean():.0%}, home value {T.homeval.notna().mean():.0%}, "
        f"rent {T.rent.notna().mean():.0%}, votes {T.votes_total.notna().mean():.0%}; ZIPs with Zillow {Z.zhvi.notna().mean():.0%}")
    bounds = T.total_bounds
    return {"id": rid, "name": R["name"], "states": [STATES[s][2] for s in R["states"]],
            "view": R["view"] or [round(float(v), 4) for v in bounds], "bounds": [round(float(v), 4) for v in bounds],
            "people": int(T["pop"].sum()), "tracts": len(T)}


if __name__ == "__main__":
    log("loading shared inputs")
    S = load_acs()
    V, BGV = load_votes()
    zhvi, zhvi_ly, zdate = load_zillow("zillow_zhvi_zip.csv")
    zori, _, rdate = load_zillow("zillow_zori_zip.csv")
    COUNTY = gpd.read_file(f"{RAW}/cb_2024_us_county_500k.zip").to_crs(4326)
    COUNTY = COUNTY[COUNTY.STATEFP.isin(OUR)]
    ZCTA = load_zcta(zhvi, zhvi_ly, zori)
    STATE_TL = gpd.read_file(f"{RAW}/tl_2024_us_state.zip", columns=["STATEFP", "STUSPS"]).to_crs(4326)
    OSM = {}
    for st, (ab, _, _) in STATES.items():
        p = f"{RAW}/osm_{ab}.json"
        if os.path.exists(p):
            d = pd.DataFrame(json.load(open(p, encoding="utf-8")))
            OSM[st] = gpd.GeoDataFrame(d[["name"]], geometry=gpd.points_from_xy(d.lon, d.lat), crs=4326) if len(d) else None
    log(f"shared inputs ready; OSM neighborhoods for {sorted(k for k, v in OSM.items() if v is not None)}")

    meta_path = f"{OUT}/regions.json"
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {"regions": {}}
    for rid in ONLY:
        meta["regions"][rid] = build_region(rid, S, V, BGV, OSM)
    meta.update({"order": list(REGIONS), "acs": "2020–24", "zhvi_date": zdate, "zori_date": rdate,
                 "dots_detail": DOTS_PER_PERSON_DETAIL, "dots_overview": DOTS_PER_PERSON_OVERVIEW})
    json.dump(meta, open(meta_path, "w", encoding="utf-8"), indent=1)
    log("done")
