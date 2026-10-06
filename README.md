# HydroShield AI

HydroShield is a flood-analysis and disaster-response prototype. It processes operator-supplied geospatial data; it is not a live monitoring service or an emergency authority.

## Run Locally

Requires Python 3.12 and Node.js 24/npm 11 (the versions used for verification).

Backend, from PowerShell:

```powershell
cd EPICS--main
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item ..\.env.example .env }
uvicorn api_server:app --reload --port 8000
```

Run the preprocessing unit tests from `EPICS--main` with `python -m unittest discover -s tests`.

Frontend, in a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open the Vite URL printed by the development server. Set `VITE_API_URL` if the API is not at `http://127.0.0.1:8000/api`.

An alternate Streamlit workflow is available with `cd EPICS--main; streamlit run app.py`.

## Configuration

Set `OPENAI_API_KEY` and a provider-supported `OPENAI_MODEL` in `EPICS--main/.env` to use the assistant. The assistant sends submitted conversation content to OpenAI. `CORS_ORIGINS` is a comma-separated list of permitted frontend origins; its default allows the local Vite origins only. Do not commit `.env` or place credentials in frontend variables.

## Implemented Workflows

- Raster inspection and threshold-based flood-candidate analysis are exposed by the FastAPI API.
- Zipped Sentinel-1 GRD SAFE products can be preprocessed locally with SNAP GPT before analysis. The graph applies orbit correction, thermal-noise and GRD border-noise removal, linear Sigma0 calibration, terrain correction to a scene-derived UTM CRS, and a final conversion to dB.
- Random Forest classification requires a user-supplied label raster aligned exactly to the input raster.
- Safe routing requires a raster, CRS-tagged road and shelter vectors, and a start location.
- The Streamlit app combines analysis, downloadable masks, map display, alerts derived from the current analysis, and routing.
- The React app provides on-demand Analytics, Routing, shelter listings, and an AI assistant. Its Flood Map is currently a basemap; it does not share generated analysis overlays with Analytics.

## Data And Limitations

`datasets/sar/peak_flood_subset.tif` is readable as a one-band Float32 GeoTIFF in EPSG:4326, but all 5,738,114 valid pixels contain `0.0`. The backend rejects it because it is not usable backscatter; replace it with a validated Sentinel-1-derived raster before running analysis or routing. Its geographic CRS also does not support the current projected-area statistic.

The bundled road GeoJSON contains one line and the shelter GeoJSON contains two points, both in EPSG:4326. The route engine clips roads to raster coverage, excludes flooded or unknown samples, and reports metric distances. The shelter API has no live source and intentionally returns an empty live dataset. Historical fallback locations shown by the React shelter page are not current activation or occupancy data and must be confirmed with authorities.

To preprocess a SAFE ZIP, install ESA SNAP with the Sentinel-1 toolbox and set `SNAP_GPT_PATH` in `EPICS--main/.env` to the full path of its `gpt.exe` (for example `C:\Program Files\esa-snap\bin\gpt.exe`). SNAP also needs access to orbit files and the SRTM DEM; first-time processing may download these. Temporary JVM files, the DIMAP workspace, and SNAP's downloaded orbit/DEM auxiliary data are stored under the output directory, so keep that directory on a drive with sufficient free space. On Windows, these D: paths do not relocate the operating system page file; full-scene processing also requires sufficient system commit/page-file capacity and SNAP heap configured in its installation. Use the product's SAFE ZIP archive (with `manifest.safe`, `measurement/`, and `annotation/` inside), not a screenshot, browse export, or nested archive. The Analytics page accepts either a SAFE ZIP for preprocessing or an already preprocessed GeoTIFF. Safe Routing also preprocesses a SAFE ZIP when selected. The Streamlit workflow exposes the same local preprocessing step. GPT uses a 256 MB tile cache and one processing worker to reduce memory pressure; DIMAP output is converted in row windows to a compressed BigTIFF so scenes larger than 4 GB are supported without loading the full scene into Python memory. The preprocessor reports SNAP's stderr when the graph fails; this log identifies failures such as missing toolbox operators, orbit download errors, or DEM download errors.

The React dashboard and alerts do not receive live flood or alert feeds. Risk thresholds are demonstrative, threshold detection is an exploratory water-candidate heuristic, and Random Forest quality depends on the supplied labels. No agentic workflow, live Sentinel-1 ingestion, or operational emergency messaging is implemented.