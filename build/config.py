"""Shared settings for the build scripts."""

# state FIPS -> (postal abbreviation, Census folder name, display name)
STATES = {
    "51": ("va", "Virginia", "Virginia"),
    "24": ("md", "Maryland", "Maryland"),
    "11": ("dc", "District_of_Columbia", "DC"),
    "37": ("nc", "North_Carolina", "North Carolina"),
    "12": ("fl", "Florida", "Florida"),
    "34": ("nj", "New_Jersey", "New Jersey"),
    "09": ("ct", "Connecticut", "Connecticut"),
}

# one map tab per region; "view" is the opening map extent [west, south, east, north]
REGIONS = {
    "dmv": {"name": "DC · Maryland · Virginia", "states": ["11", "24", "51"], "view": [-77.55, 38.62, -76.85, 39.08]},
    "nc":  {"name": "North Carolina", "states": ["37"], "view": None},
    "fl":  {"name": "Florida", "states": ["12"], "view": None},
    "nj":  {"name": "New Jersey", "states": ["34"], "view": None},
    "ct":  {"name": "Connecticut", "states": ["09"], "view": None},
}

DOTS_PER_PERSON_DETAIL = 2     # street-level dots: 1 dot = 2 people
DOTS_PER_PERSON_OVERVIEW = 25  # state-wide view: 1 dot = 25 people
SEED = 42
