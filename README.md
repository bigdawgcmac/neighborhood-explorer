# Neighborhood explorer

An interactive map of race, income, home value, rent, and 2024 vote by census tract for five areas: DC · Maryland · Virginia, North Carolina, Florida, New Jersey, and Connecticut.

## Open it
Double-click **Open map.bat**. It starts a small local web server (Python) and opens http://localhost:8765. Close the black window to stop it. An internet connection is needed for the base map.

Use **Map → Satellite** to see the data over Esri World Imagery (the data-opacity slider controls how much imagery shows through). Drop pins with **+ Drop a pin** or a right-click; pins are saved in your browser.

## Data
| Layer | Source | Level |
|---|---|---|
| Race dots | 2020 Census P.L. 94-171, table P2 | Census block (1 dot = 2 people zoomed in, 25 zoomed out) |
| Race %, income, home value, rent | ACS 2020–24 5-year (B03002, B19013, B25077, B25064) | Tract, county, place, town |
| Home value, rent (Zillow) | Zillow ZHVI (all homes, mid-tier) and ZORI | ZIP code |
| 2024 presidential vote | Harvard Dataverse, "Reallocating U.S. Election Results (2016–2024) from Precincts to Census Geographies" (imperviousness method) | Tract; places/towns via block groups. Connecticut is town-level only |
| Neighborhood names | OpenStreetMap (place=neighbourhood/suburb/quarter) | Point |
| Boundaries | Census cartographic boundary files 2024 (ZCTAs 2020) | |

## Rebuild
```
pip install -r build/requirements.txt
python -I build/download.py <raw_folder>
python -I build/build.py <raw_folder> data
```
Downloads are about 1.5 GB and cached. `build.py` takes region ids (`dmv nc fl nj ct`) to rebuild only some tabs. Regions and dot densities are set in `build/config.py`.
