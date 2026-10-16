
import requests
import time

BBOX = "25.4458,84.9966,25.6542,85.3329"

query = f"""
[out:json][timeout:60];
(
  nwr["amenity"="shelter"]({BBOX});
  nwr["emergency"="assembly_point"]({BBOX});
  nwr["social_facility"="shelter"]({BBOX});
  nwr["amenity"="hospital"]({BBOX});
  nwr["amenity"="clinic"]({BBOX});
);
out center tags;
"""

# Try alternative public Overpass servers if one is unavailable.
endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

headers = {
    "User-Agent": "HydroShield-AI/1.0 (flood-routing student project)",
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
}

data = None

for endpoint in endpoints:
    try:
        print(f"\nTrying: {endpoint}")
        response = requests.post(
            endpoint,
            data={"data": query},
            headers=headers,
            timeout=100,
        )
        response.raise_for_status()
        data = response.json()
        print("Request successful!")
        break
    except requests.RequestException as exc:
        print("Request failed:", exc)
    except ValueError as exc:
        print("Invalid JSON response:", exc)

if data is None:
    raise SystemExit(
        "\nAll Overpass servers failed. Check your internet connection "
        "or retry later; no files were changed."
    )

elements = data.get("elements", [])
print(f"\nMapped facilities found: {len(elements)}")

for item in elements:
    tags = item.get("tags", {})
    center = item.get("center", {})

    lat = item.get("lat", center.get("lat"))
    lon = item.get("lon", center.get("lon"))

    print("-" * 45)
    print("Name:", tags.get("name", "Unnamed"))
    print("Type:", tags.get("amenity", ""))
    print("Emergency tag:", tags.get("emergency", ""))
    print("Latitude:", lat)
    print("Longitude:", lon)
    print("OSM ID:", item.get("type"), item.get("id"))
    print("Address:", tags.get("addr:full", "Not provided"))

print("\nSearch completed. Existing datasets were not modified.")
