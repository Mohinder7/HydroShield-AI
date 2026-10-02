import { useState } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    Polyline,
    Popup,
    useMap,
    useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { findSafeRoute } from "../api";

import "leaflet/dist/leaflet.css";

const startIcon = new L.Icon({
    iconUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    shadowSize: [41, 41],
});

const defaultCenter = [16.5062, 80.6480];

function LocationPicker({ onLocationSelect }) {
    useMapEvents({
        click(event) {
            onLocationSelect(
                event.latlng.lat,
                event.latlng.lng,
                "map"
            );
        },
    });

    return null;
}

function RouteMapController({ route }) {
    const map = useMap();

    if (route && route.length > 1) {
        const bounds = L.latLngBounds(route);

        map.fitBounds(bounds, {
            padding: [40, 40],
        });
    }

    return null;
}

export default function Routing() {
    const [rasterFile, setRasterFile] = useState(null);
    const [roadsFile, setRoadsFile] = useState(null);
    const [sheltersFile, setSheltersFile] = useState(null);

    // Location is kept internally.
    // The user does not need to enter coordinates.
    const [userLocation, setUserLocation] = useState(null);
    const [locationMethod, setLocationMethod] = useState("");

    const [band, setBand] = useState(1);
    const [threshold, setThreshold] = useState(-17);
    const [valueScale, setValueScale] = useState("dB");

    const [loading, setLoading] = useState(false);
    const [locating, setLocating] = useState(false);

    const [result, setResult] = useState(null);
    const [error, setError] = useState("");

    // -----------------------------------------
    // GET CURRENT GPS LOCATION
    // -----------------------------------------
    const useCurrentLocation = () => {
        setError("");
        setResult(null);

        if (!navigator.geolocation) {
            setError(
                "Location services are not supported by this browser."
            );
            return;
        }

        setLocating(true);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                setUserLocation({
                    latitude,
                    longitude,
                });

                setLocationMethod("gps");
                setLocating(false);
            },
            (geoError) => {
                setLocating(false);

                let message =
                    "Unable to detect your location.";

                if (geoError.code === 1) {
                    message =
                        "Location permission was denied. Please allow location access or select your location on the map.";
                } else if (geoError.code === 2) {
                    message =
                        "Your location could not be determined. Please select your location on the map.";
                } else if (geoError.code === 3) {
                    message =
                        "Location request timed out. Please try again or select your location on the map.";
                }

                setError(message);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000,
            }
        );
    };

    // -----------------------------------------
    // MAP LOCATION SELECTION
    // -----------------------------------------
    const selectMapLocation = (
        latitude,
        longitude
    ) => {
        setUserLocation({
            latitude,
            longitude,
        });

        setLocationMethod("map");
        setError("");
        setResult(null);
    };

    // -----------------------------------------
    // FIND SAFE ROUTE
    // -----------------------------------------
    const handleFindRoute = async () => {
        setError("");
        setResult(null);

        if (!userLocation) {
            setError(
                "Please detect your location or select your location on the map."
            );
            return;
        }

        if (!rasterFile) {
            setError(
                "Please upload a Sentinel-1 GeoTIFF flood raster."
            );
            return;
        }

        if (!roadsFile) {
            setError(
                "Please upload the road network dataset."
            );
            return;
        }

        if (!sheltersFile) {
            setError(
                "Please upload the shelter dataset."
            );
            return;
        }

        try {
            setLoading(true);

            const data = await findSafeRoute({
                rasterFile,
                roadsFile,
                sheltersFile,
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
                band,
                threshold,
                valueScale,
            });

            setResult(data);
        } catch (err) {
            setError(
                err.message ||
                    "Safe route calculation failed."
            );
        } finally {
            setLoading(false);
        }
    };

    const routeCoordinates = result?.route || [];

    const startPosition = userLocation
        ? [
              userLocation.latitude,
              userLocation.longitude,
          ]
        : null;

    const shelterPosition = result?.shelter
        ? [
              result.shelter.latitude,
              result.shelter.longitude,
          ]
        : null;

    const mapCenter =
        startPosition || defaultCenter;

    return (
        <div className="page-container routing-page">

            {/* PAGE HEADER */}
            <div className="page-header">
                <div>
                    <h1>Safe Routing</h1>

                    <p>
                        Find a flood-aware route to a
                        reachable emergency shelter.
                    </p>
                </div>

                <div className="page-status">
                    <span className="status-dot"></span>
                    Flood-aware routing
                </div>
            </div>

            <div className="routing-layout">

                {/* =====================================
                    LEFT CONTROL PANEL
                ===================================== */}
                <div className="routing-panel">

                    <div className="panel-title">

                        <div className="panel-icon">
                            🛣️
                        </div>

                        <div>
                            <h2>Emergency Route</h2>

                            <p>
                                Get directions to a
                                reachable shelter.
                            </p>
                        </div>

                    </div>


                    {/* =================================
                        LOCATION
                    ================================= */}
                    <div className="form-section">

                        <h3>📍 Your Location</h3>

                        <p className="location-help">
                            You don't need to know your
                            latitude or longitude.
                        </p>


                        {/* GPS BUTTON */}
                        <button
                            className="location-button"
                            onClick={
                                useCurrentLocation
                            }
                            disabled={locating}
                        >
                            <span>
                                {locating
                                    ? "⏳"
                                    : "📍"}
                            </span>

                            {locating
                                ? "Detecting your location..."
                                : "Use My Current Location"}
                        </button>


                        {/* LOCATION STATUS */}
                        {userLocation && (
                            <div className="location-detected">

                                <div className="location-check">
                                    ✓
                                </div>

                                <div>
                                    <strong>
                                        Location detected
                                    </strong>

                                    <small>
                                        {locationMethod ===
                                        "gps"
                                            ? "Using your device location"
                                            : "Location selected on map"}
                                    </small>
                                </div>

                            </div>
                        )}


                        <div className="location-divider">
                            <span>OR</span>
                        </div>


                        <div className="map-selection-hint">

                            <span className="map-hint-icon">
                                🗺️
                            </span>

                            <div>
                                <strong>
                                    Select your location
                                </strong>

                                <small>
                                    Click anywhere on the
                                    map to set your starting
                                    point.
                                </small>
                            </div>

                        </div>

                    </div>


                    {/* =================================
                        FLOOD RASTER
                    ================================= */}
                    <div className="form-section">

                        <h3>🛰️ Flood Raster</h3>

                        <label className="file-upload">

                            <input
                                type="file"
                                accept=".tif,.tiff"
                                onChange={(e) =>
                                    setRasterFile(
                                        e.target.files?.[0] ||
                                            null
                                    )
                                }
                            />

                            <span className="upload-icon">
                                🛰️
                            </span>

                            <span>
                                {rasterFile
                                    ? rasterFile.name
                                    : "Choose Sentinel-1 GeoTIFF"}
                            </span>

                        </label>

                    </div>


                    {/* =================================
                        ROAD NETWORK
                    ================================= */}
                    <div className="form-section">

                        <h3>🛣️ Road Network</h3>

                        <label className="file-upload">

                            <input
                                type="file"
                                accept=".geojson,.json,.gpkg,.zip"
                                onChange={(e) =>
                                    setRoadsFile(
                                        e.target.files?.[0] ||
                                            null
                                    )
                                }
                            />

                            <span className="upload-icon">
                                🛣️
                            </span>

                            <span>
                                {roadsFile
                                    ? roadsFile.name
                                    : "Choose road dataset"}
                            </span>

                        </label>

                        <small>
                            GeoJSON, GPKG or Shapefile ZIP
                            with CRS metadata.
                        </small>

                    </div>


                    {/* =================================
                        SHELTERS
                    ================================= */}
                    <div className="form-section">

                        <h3>🏠 Emergency Shelters</h3>

                        <label className="file-upload">

                            <input
                                type="file"
                                accept=".geojson,.json,.gpkg,.zip"
                                onChange={(e) =>
                                    setSheltersFile(
                                        e.target.files?.[0] ||
                                            null
                                    )
                                }
                            />

                            <span className="upload-icon">
                                🏠
                            </span>

                            <span>
                                {sheltersFile
                                    ? sheltersFile.name
                                    : "Choose shelter dataset"}
                            </span>

                        </label>

                        <small>
                            Shelter points must include
                            CRS metadata.
                        </small>

                    </div>


                    {/* =================================
                        FLOOD SETTINGS
                    ================================= */}
                    <div className="form-section">

                        <h3>🌊 Flood Detection</h3>

                        <div className="coordinate-grid">

                            <div className="form-group">

                                <label>
                                    Band
                                </label>

                                <select
                                    value={band}
                                    onChange={(e) =>
                                        setBand(
                                            Number(
                                                e.target.value
                                            )
                                        )
                                    }
                                >
                                    <option value={1}>
                                        Band 1
                                    </option>

                                    <option value={2}>
                                        Band 2
                                    </option>
                                </select>

                            </div>


                            <div className="form-group">

                                <label>
                                    Value Scale
                                </label>

                                <select
                                    value={valueScale}
                                    onChange={(e) =>
                                        setValueScale(
                                            e.target.value
                                        )
                                    }
                                >
                                    <option value="dB">
                                        dB
                                    </option>

                                    <option value="Linear power">
                                        Linear Power
                                    </option>
                                </select>

                            </div>

                        </div>


                        <div className="form-group threshold-group">

                            <label>
                                Flood Threshold:{" "}
                                <strong>
                                    {threshold} dB
                                </strong>
                            </label>

                            <input
                                type="range"
                                min="-30"
                                max="-5"
                                step="0.5"
                                value={threshold}
                                onChange={(e) =>
                                    setThreshold(
                                        Number(
                                            e.target.value
                                        )
                                    )
                                }
                            />

                            <div className="range-labels">

                                <span>
                                    -30 dB
                                </span>

                                <span>
                                    -5 dB
                                </span>

                            </div>

                        </div>

                    </div>


                    {/* ERROR */}
                    {error && (
                        <div className="route-error">

                            <strong>
                                ⚠️ Routing Notice
                            </strong>

                            <span>
                                {error}
                            </span>

                        </div>
                    )}


                    {/* FIND ROUTE */}
                    <button
                        className="find-route-button"
                        onClick={handleFindRoute}
                        disabled={loading}
                    >
                        {loading
                            ? "Calculating Safe Route..."
                            : "Find Safe Route →"}
                    </button>


                    <p className="routing-note">
                        HydroShield screens the road network
                        against the supplied flood classification
                        before selecting a reachable shelter.
                    </p>

                </div>


                {/* =====================================
                    RIGHT MAP
                ===================================== */}
                <div className="routing-map-section">

                    <div className="map-header">

                        <div>

                            <h2>
                                Flood-Aware Route Map
                            </h2>

                            <p>
                                Click the map to select your
                                starting location.
                            </p>

                        </div>


                        {result?.success && (
                            <div className="route-success-badge">

                                <span className="status-dot"></span>

                                Route calculated

                            </div>
                        )}

                    </div>


                    <div className="routing-map">

                        <MapContainer
                            center={mapCenter}
                            zoom={12}
                            scrollWheelZoom={true}
                            style={{
                                width: "100%",
                                height: "100%",
                            }}
                        >

                            <TileLayer
                                attribution="&copy; OpenStreetMap contributors"
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />


                            {/* MAP CLICK LOCATION */}
                            <LocationPicker
                                onLocationSelect={
                                    selectMapLocation
                                }
                            />


                            {/* USER LOCATION */}
                            {startPosition && (
                                <Marker
                                    position={
                                        startPosition
                                    }
                                    icon={startIcon}
                                >
                                    <Popup>

                                        <strong>
                                            Your Starting
                                            Location
                                        </strong>

                                        <br />

                                        {locationMethod ===
                                        "gps"
                                            ? "Detected from your device"
                                            : "Selected on map"}

                                    </Popup>

                                </Marker>
                            )}


                            {/* SHELTER */}
                            {shelterPosition && (
                                <Marker
                                    position={
                                        shelterPosition
                                    }
                                >
                                    <Popup>

                                        <strong>
                                            {
                                                result
                                                    .shelter
                                                    .name
                                            }
                                        </strong>

                                        <br />

                                        Reachable emergency
                                        shelter

                                    </Popup>
                                </Marker>
                            )}


                            {/* ROUTE */}
                            {routeCoordinates.length >
                                1 && (
                                <>
                                    <Polyline
                                        positions={
                                            routeCoordinates
                                        }
                                        pathOptions={{
                                            color:
                                                "#16a34a",
                                            weight: 7,
                                            opacity: 0.9,
                                        }}
                                    />

                                    <RouteMapController
                                        route={
                                            routeCoordinates
                                        }
                                    />
                                </>
                            )}

                        </MapContainer>


                        {/* EMPTY MAP */}
                        {!userLocation &&
                            !loading && (
                                <div className="map-empty-state">

                                    <div>
                                        📍
                                    </div>

                                    <h3>
                                        Set your location
                                    </h3>

                                    <p>
                                        Click on the map or
                                        use your device
                                        location.
                                    </p>

                                </div>
                            )}


                        {/* LOADING */}
                        {loading && (
                            <div className="map-loading-state">

                                <div className="loading-spinner"></div>

                                <strong>
                                    Finding a safe route...
                                </strong>

                                <span>
                                    Analyzing flooded and
                                    reachable roads
                                </span>

                            </div>
                        )}

                    </div>


                    {/* =================================
                        ROUTE RESULTS
                    ================================= */}
                    {result?.success && (
                        <div className="route-results">

                            <div className="result-card">

                                <span className="result-icon">
                                    📏
                                </span>

                                <div>

                                    <small>
                                        Route Distance
                                    </small>

                                    <strong>
                                        {result.distance_m >=
                                        1000
                                            ? `${(
                                                  result.distance_m /
                                                  1000
                                              ).toFixed(
                                                  2
                                              )} km`
                                            : `${Math.round(
                                                  result.distance_m
                                              )} m`}
                                    </strong>

                                </div>

                            </div>


                            <div className="result-card">

                                <span className="result-icon">
                                    🚧
                                </span>

                                <div>

                                    <small>
                                        Affected Roads
                                    </small>

                                    <strong>
                                        {
                                            result.affected_roads
                                        }
                                    </strong>

                                </div>

                            </div>


                            <div className="result-card shelter-result">

                                <span className="result-icon">
                                    🏠
                                </span>

                                <div>

                                    <small>
                                        Reachable Shelter
                                    </small>

                                    <strong>
                                        {
                                            result.shelter
                                                .name
                                        }
                                    </strong>

                                </div>

                            </div>

                        </div>
                    )}


                    {/* NO ROUTE */}
                    {result &&
                        !result.success && (
                            <div className="no-route-result">

                                <div>
                                    ⚠️
                                </div>

                                <div>

                                    <strong>
                                        No safe reachable
                                        shelter found
                                    </strong>

                                    <p>
                                        {result.message}
                                    </p>

                                </div>

                            </div>
                        )}

                </div>

            </div>
        </div>
    );
}