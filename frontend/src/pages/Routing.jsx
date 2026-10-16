import { useEffect, useState } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    Polyline,
    Popup,
    ImageOverlay,
    useMap,
    useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
    findSafeRoute,
    findSafeRouteBundled,
    getRasterInfo,
    preprocessSentinel1,
    getFloodCandidateOverlay
} from "../api";
import Icon from "../components/Icon";


import "leaflet/dist/leaflet.css";

// ── Leaflet marker icons ───────────────────────────────────────────────────
const startIcon = new L.Icon({
    iconUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    shadowSize: [41, 41],
});

const shelterIcon = new L.Icon({
    iconUrl:
        "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
    shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    shadowSize: [41, 41],
});

// Raster coverage centre: Bihar/Gaya region (lon 83.27–84.53, lat 24.15–25.14)
const DEFAULT_CENTER = [24.647, 83.903];

// ── Sub-components ─────────────────────────────────────────────────────────
function LocationPicker({ onLocationSelect }) {
    useMapEvents({
        click(e) {
            onLocationSelect(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

function RouteMapController({ route }) {
    const map = useMap();
    if (route && route.length > 1) {
        map.fitBounds(L.latLngBounds(route), { padding: [40, 40] });
    }
    return null;
}

function FloodOverlayMapController({ bounds }) {
    const map = useMap();

    useEffect(() => {
        if (bounds) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }
    }, [map, bounds]);

    return null;
}

// ══════════════════════════════════════════════════════════════════════════
export default function Routing() {
    // ── routing mode ──────────────────────────────────────────────────────
    // "bundled"  → server uses bundled datasets from disk (no upload)
    // "custom"   → user uploads their own files
    const [mode, setMode] = useState("bundled");

    // ── location ──────────────────────────────────────────────────────────
    const [userLocation,    setUserLocation]    = useState(null);
    const [locationMethod,  setLocationMethod]  = useState("");
    const [locating,        setLocating]        = useState(false);

    // ── custom-mode file state ─────────────────────────────────────────────
    const [rasterFile,    setRasterFile]    = useState(null);
    const [roadsFile,     setRoadsFile]     = useState(null);
    const [sheltersFile,  setSheltersFile]  = useState(null);
    const [bandCount,     setBandCount]     = useState(1);
    const [bandNames,     setBandNames]     = useState([]);
    const [preprocessing, setPreprocessing] = useState(false);

    // ── shared analysis settings ──────────────────────────────────────────
    const [band,       setBand]       = useState(1);
    const [threshold,  setThreshold]  = useState(-17);
    const [valueScale, setValueScale] = useState("dB");

    // ── result state ──────────────────────────────────────────────────────
    const [loading,  setLoading]  = useState(false);
    const [result,   setResult]   = useState(null);
    const [error,    setError]    = useState("");

    // ── flood prediction overlay ─────────────────────────────────────────
    const [showFloodOverlay, setShowFloodOverlay] = useState(false);
    const [floodOverlay, setFloodOverlay] = useState(null);
    const [overlayLoading, setOverlayLoading] = useState(false);
    const [overlayError, setOverlayError] = useState("");

    // ── GPS location ──────────────────────────────────────────────────────
    const useCurrentLocation = () => {
        setError("");
        setResult(null);
        if (!navigator.geolocation) {
            setError("Location services are not supported by this browser.");
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
                setLocationMethod("gps");
                setLocating(false);
            },
            (err) => {
                setLocating(false);
                const msgs = {
                    1: "Location permission denied. Click the map to set your location.",
                    2: "Location unavailable. Click the map to set your location.",
                    3: "Location timed out. Click the map to set your location.",
                };
                setError(msgs[err.code] || "Could not detect location.");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    };

    const selectMapLocation = (lat, lng) => {
        setUserLocation({ latitude: lat, longitude: lng });
        setLocationMethod("map");
        setError("");
        setResult(null);
    };

    // ── custom raster change ──────────────────────────────────────────────
    const handleRasterChange = async (e) => {
        const f = e.target.files?.[0] || null;
        setRasterFile(null);
        setBand(1);
        setBandCount(1);
        setBandNames([]);
        setResult(null);
        setError("");
        if (!f) return;
        try {
            let raster = f;
            if (f.name.toLowerCase().endsWith(".zip")) {
                setPreprocessing(true);
                raster = await preprocessSentinel1(f);
            }
            const info = await getRasterInfo(raster);
            setRasterFile(raster);
            setBandCount(info.bands);
            setBandNames(info.descriptions || []);
        } catch (err) {
            setError(err.message || "Could not inspect raster.");
        } finally {
            setPreprocessing(false);
        }
    };

    // ── find route ────────────────────────────────────────────────────────
    const handleFindRoute = async () => {
        setError("");
        setResult(null);

        if (!userLocation) {
            setError("Please detect or click your location on the map first.");
            return;
        }

        setLoading(true);
        try {
            let data;
            if (mode === "bundled") {
                // ✅ No file upload — server reads all datasets from disk
                data = await findSafeRouteBundled({
                    latitude:   userLocation.latitude,
                    longitude:  userLocation.longitude,
                    band,
                    threshold,
                    valueScale,
                });
            } else {
                // Custom mode — user-supplied files
                if (!rasterFile)   { setError("Upload a flood raster."); setLoading(false); return; }
                if (!roadsFile)    { setError("Upload a road network dataset."); setLoading(false); return; }
                if (!sheltersFile) { setError("Upload a shelter dataset."); setLoading(false); return; }
                data = await findSafeRoute({
                    rasterFile,
                    roadsFile,
                    sheltersFile,
                    latitude:   userLocation.latitude,
                    longitude:  userLocation.longitude,
                    band,
                    threshold,
                    valueScale,
                });
            }
            setResult(data);
        } catch (err) {
            setError(err.message || "Safe route calculation failed.");
        } finally {
            setLoading(false);
        }
    };

    // ── load and toggle flood overlay ────────────────────────────────────
const handleFloodOverlayToggle = async () => {
    if (showFloodOverlay) {
        setShowFloodOverlay(false);
        return;
    }

    setOverlayError("");
    setOverlayLoading(true);

    try {
        const data = await getFloodCandidateOverlay();

        setFloodOverlay(data);
        setShowFloodOverlay(true);
    } catch (err) {
        setOverlayError(
            err.message || "Could not load flood-candidate overlay."
        );
    } finally {
        setOverlayLoading(false);
    }
};

    // ── derived map values ─────────────────────────────────────────────────
    const routeCoords   = result?.route || [];
    const startPosition = userLocation
        ? [userLocation.latitude, userLocation.longitude]
        : null;
    const shelterPosition = result?.shelter
        ? [result.shelter.latitude, result.shelter.longitude]
        : null;
    const mapCenter = startPosition || DEFAULT_CENTER;

    // ══════════════════════════════════════════════════════════════════════
    return (
        <div className="page-container routing-page">

            {/* PAGE HEADER */}
            <div className="page-header">
                <div>
                    <h1>Safe Routing</h1>
                    <p>Find a flood-aware route to a reachable emergency shelter.</p>
                </div>
                <div className="page-status">
                    <span className="status-dot"></span>
                    Flood-aware routing · Bihar/Gaya
                </div>
            </div>

            <div className="routing-layout">

                {/* =========================================================
                    LEFT CONTROL PANEL
                ========================================================= */}
                <div className="routing-panel">

                    <div className="panel-title">
                        <div className="panel-icon">
                            <Icon name="route" size={24} />
                        </div>
                        <div>
                            <h2>Emergency Route</h2>
                            <p>Get directions to a reachable shelter.</p>
                        </div>
                    </div>

                    {/* ── Mode selector ──────────────────────────────────── */}
                    <div className="form-section">
                        <h3><Icon name="layers" size={17} /> Dataset Mode</h3>

                        <div className="mode-toggle">
                            <button
                                className={`mode-btn${mode === "bundled" ? " active" : ""}`}
                                onClick={() => { setMode("bundled"); setResult(null); setError(""); }}
                            >
                                <Icon name="pin" size={15} />
                                Bundled (Patna)
                            </button>
                            <button
                                className={`mode-btn${mode === "custom" ? " active" : ""}`}
                                onClick={() => { setMode("custom"); setResult(null); setError(""); }}
                            >
                                <Icon name="upload" size={15} />
                                Custom Upload
                            </button>
                        </div>

                        {mode === "bundled" && (
                            <div className="bundled-info-box" style={{marginTop:"10px"}}>
                                <Icon name="layers" size={17} />
                                <div>
                                    <strong>Bihar SAR bundled datasets</strong>
                                    <span>
                                        SAR raster (Gaya/Bihar region) · roads · shelters — all
                                        read directly on the server.
                                        Click the map in the <strong>Bihar region</strong> (lat 24–25, lon 83–85) to set your start.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Location ───────────────────────────────────────── */}
                    <div className="form-section">
                        <h3><Icon name="pin" size={17} /> Your Location</h3>
                        <p className="location-help">
                            Use your GPS or click anywhere on the map.
                        </p>

                        <button
                            className="location-button"
                            onClick={useCurrentLocation}
                            disabled={locating}
                        >
                            {locating
                                ? <span className="icon-spinner" aria-hidden="true" />
                                : <Icon name="pin" size={17} />}
                            {locating ? "Detecting location…" : "Use My Current Location"}
                        </button>

                        {userLocation && (
                            <div className="location-detected">
                                <div className="location-check">
                                    <Icon name="check" size={15} />
                                </div>
                                <div>
                                    <strong>Location set</strong>
                                    <small>
                                        {locationMethod === "gps"
                                            ? `GPS · ${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)}`
                                            : `Map click · ${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)}`}
                                    </small>
                                </div>
                            </div>
                        )}

                        <div className="location-divider"><span>OR</span></div>

                        <div className="map-selection-hint">
                            <span className="map-hint-icon"><Icon name="map" size={19} /></span>
                            <div>
                                <strong>Click on the map</strong>
                                <small>Tap anywhere on the map to set your starting point.</small>
                            </div>
                        </div>
                    </div>

                    {/* ── Flood detection settings ───────────────────────── */}
                    <div className="form-section">
                        <h3><Icon name="droplet" size={17} /> Flood Detection</h3>

                        <div className="coordinate-grid">
                            {mode === "custom" && (
                                <div className="form-group">
                                    <label>Band</label>
                                    <select
                                        value={band}
                                        onChange={(e) => { setBand(Number(e.target.value)); setResult(null); }}
                                    >
                                        {Array.from({ length: bandCount }, (_, i) => (
                                            <option key={i + 1} value={i + 1}>
                                                {bandNames[i] && bandNames[i] !== `Band ${i + 1}`
                                                    ? `Band ${i + 1} · ${bandNames[i]}`
                                                    : `Band ${i + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="form-group">
                                <label>Value Scale</label>
                                <select
                                    value={valueScale}
                                    onChange={(e) => setValueScale(e.target.value)}
                                >
                                    <option value="dB">dB</option>
                                    <option value="Linear power">Linear Power</option>
                                </select>
                            </div>
                        </div>

                        <div className="form-group threshold-group">
                            <label>
                                Flood Threshold: <strong>{threshold} dB</strong>
                            </label>
                            <input
                                type="range"
                                min="-30"
                                max="-5"
                                step="0.5"
                                value={threshold}
                                onChange={(e) => setThreshold(Number(e.target.value))}
                            />
                            <div className="range-labels">
                                <span>−30 dB</span>
                                <span>−5 dB</span>
                            </div>
                        </div>
                    </div>

                    {/* ── Custom file uploads (only in custom mode) ──────── */}
                    {mode === "custom" && (
                        <div className="form-section">
                            <h3><Icon name="upload" size={17} /> Custom Datasets</h3>

                            <div className="form-group">
                                <label>Flood Raster (GeoTIFF or zipped GRD SAFE)</label>
                                <label className="file-upload">
                                    <input
                                        type="file"
                                        accept=".tif,.tiff,.zip"
                                        onChange={handleRasterChange}
                                    />
                                    <span className="upload-icon"><Icon name="upload" size={18} /></span>
                                    <span>
                                        {rasterFile ? rasterFile.name
                                            : preprocessing ? "Preprocessing with SNAP…"
                                            : "Choose GeoTIFF or zipped GRD SAFE"}
                                    </span>
                                </label>
                                <small>
                                    Only use small GeoTIFFs (&lt;200 MB). For the
                                    1.4 GB Patna dataset use Bundled mode above.
                                </small>
                            </div>

                            <div className="form-group">
                                <label>Road Network</label>
                                <label className="file-upload">
                                    <input
                                        type="file"
                                        accept=".geojson,.json,.gpkg,.zip"
                                        onChange={(e) => setRoadsFile(e.target.files?.[0] || null)}
                                    />
                                    <span className="upload-icon"><Icon name="upload" size={18} /></span>
                                    <span>{roadsFile ? roadsFile.name : "Choose road dataset"}</span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label>Emergency Shelters</label>
                                <label className="file-upload">
                                    <input
                                        type="file"
                                        accept=".geojson,.json,.gpkg,.zip"
                                        onChange={(e) => setSheltersFile(e.target.files?.[0] || null)}
                                    />
                                    <span className="upload-icon"><Icon name="upload" size={18} /></span>
                                    <span>{sheltersFile ? sheltersFile.name : "Choose shelter dataset"}</span>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* ── Error ─────────────────────────────────────────── */}
                    {error && (
                        <div className="route-error">
                            <strong><Icon name="alert" size={17} /> Notice</strong>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* ── Find Route button ─────────────────────────────── */}
                    <button
                        className="find-route-button"
                        onClick={handleFindRoute}
                        disabled={loading || preprocessing}
                    >
                        {loading
                            ? "Calculating Safe Route…"
                            : mode === "bundled"
                            ? "▶ Find Safe Route (Bundled)"
                            : "▶ Find Safe Route (Custom)"}
                    </button>

                    <p>
                        {mode === "bundled"
                            ? "HydroShield analyses the Bihar SAR raster directly on the server — no file upload needed."
                            : "HydroShield screens the road network against the uploaded flood raster before selecting a shelter."}
                    </p>
                    {mode === "bundled" && !userLocation && (
                        <p className="routing-note" style={{marginTop: 6, color: "#2563eb", fontWeight: 600}}>
                            📍 Click anywhere in the Bihar region (lat 24.1–25.1, lon 83.3–84.5) on the map to set your start point.
                        </p>
                    )}

                </div>

                {/* =========================================================
                    RIGHT MAP
                ========================================================= */}
                <div className="routing-map-section">

                    <div className="map-header">
                        <div>
                            <h2>Flood-Aware Route Map</h2>
                            <p>Click the map to set your starting location.</p>
                        </div>
                        {result?.success && (
                            <div className="route-success-badge">
                                <span className="status-dot"></span>
                                Route calculated
                            </div>
                        )}
                    </div>

                    <div style={{
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "12px"
}}>
    <button
        type="button"
        onClick={handleFloodOverlayToggle}
        disabled={overlayLoading}
        style={{
            padding: "10px 16px",
            borderRadius: "8px",
            border: "1px solid #dc2626",
            background: showFloodOverlay ? "#991b1b" : "#fff",
            color: showFloodOverlay ? "#fff" : "#b91c1c",
            cursor: overlayLoading ? "wait" : "pointer",
            fontWeight: 600
        }}
    >
        {overlayLoading
            ? "Loading flood layer..."
            : showFloodOverlay
            ? "Hide Flood Candidates"
            : "Show Flood Candidates"}
    </button>

    {showFloodOverlay && (
        <span style={{ fontSize: "13px", color: "#b91c1c" }}>
            Red areas = predicted flood candidates
        </span>
    )}

    {overlayError && (
        <span style={{ fontSize: "13px", color: "#dc2626" }}>
            {overlayError}
        </span>
    )}
</div>

                    <div className="routing-map">
                        <MapContainer
                            center={mapCenter}
                            zoom={12}
                            scrollWheelZoom={true}
                            style={{ width: "100%", height: "100%" }}
                        >
                            <TileLayer
                                attribution="&copy; OpenStreetMap contributors"
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />

                            {showFloodOverlay && floodOverlay && (
                                <ImageOverlay
                                    url={floodOverlay.image}
                                    bounds={floodOverlay.bounds}
                                    opacity={1}
                                    interactive={false}
                                />
                            )}

                            {showFloodOverlay && floodOverlay && (
                                <FloodOverlayMapController bounds={floodOverlay.bounds} />
                            )}

                            <LocationPicker onLocationSelect={selectMapLocation} />

                            {startPosition && (
                                <Marker position={startPosition} icon={startIcon}>
                                    <Popup>
                                        <strong>Your Starting Location</strong>
                                        <br />
                                        {locationMethod === "gps"
                                            ? "Detected from device GPS"
                                            : "Selected on map"}
                                    </Popup>
                                </Marker>
                            )}

                            {shelterPosition && (
                                <Marker position={shelterPosition} icon={shelterIcon}>
                                    <Popup>
                                        <strong>{result.shelter.name}</strong>
                                        <br />
                                        Reachable emergency shelter
                                    </Popup>
                                </Marker>
                            )}

                            {routeCoords.length > 1 && (
                                <>
                                    <Polyline
                                        positions={routeCoords}
                                        pathOptions={{
                                            color: "#16a34a",
                                            weight: 7,
                                            opacity: 0.9,
                                        }}
                                    />
                                    <RouteMapController route={routeCoords} />
                                </>
                            )}
                        </MapContainer>

                        {/* Empty state */}
                        {!userLocation && !loading && (
                            <div className="map-empty-state">
                                <div><Icon name="pin" size={34} /></div>
                                <h3>Set your location</h3>
                                <p>
                                    Click on the map or use your device
                                    location to get started.
                                </p>
                            </div>
                        )}

                        {/* Loading overlay */}
                        {loading && (
                            <div className="map-loading-state">
                                <div className="loading-spinner"></div>
                                <strong>Finding a safe route…</strong>
                                <span>Analysing flooded roads and reachable shelters</span>
                            </div>
                        )}
                    </div>

                    {/* ── Route results ──────────────────────────────────── */}
                    {result?.success && (
                        <div className="route-results">

                            <div className="result-card">
                                <span className="result-icon">
                                    <Icon name="ruler" size={21} />
                                </span>
                                <div>
                                    <small>Route Distance</small>
                                    <strong>
                                        {result.distance_m >= 1000
                                            ? `${(result.distance_m / 1000).toFixed(2)} km`
                                            : `${Math.round(result.distance_m)} m`}
                                    </strong>
                                </div>
                            </div>

                            <div className="result-card">
                                <span className="result-icon">
                                    <Icon name="alert" size={21} />
                                </span>
                                <div>
                                    <small>Flooded Roads Avoided</small>
                                    <strong>{result.affected_roads}</strong>
                                </div>
                            </div>

                            <div className="result-card shelter-result">
                                <span className="result-icon">
                                    <Icon name="building" size={21} />
                                </span>
                                <div>
                                    <small>Reachable Shelter</small>
                                    <strong>{result.shelter.name}</strong>
                                </div>
                            </div>

                        </div>
                    )}

                    {/* No route found */}
                    {result && !result.success && (
                        <div className="no-route-result">
                            <div><Icon name="alert" size={23} /></div>
                            <div>
                                <strong>No safe reachable shelter found</strong>
                                <p>{result.message}</p>
                                <small>
                                    Try selecting a different starting location
                                    or adjusting the flood threshold.
                                </small>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
