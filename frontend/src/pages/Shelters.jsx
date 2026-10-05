import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import {
    MapContainer,
    TileLayer,
    CircleMarker,
    Popup,
    useMap,
} from "react-leaflet";
import { getShelters, getBundledShelters } from "../api";

import "leaflet/dist/leaflet.css";

const FALLBACK_SHELTERS = [
    {
        id: 1,
        name: "Patna Junction Relief Center",
        shortName: "Patna Junction Relief Center",
        location: "Patna Junction, Patna, Bihar",
        type: "Flood Relief Centre",
        status: "ACTIVE",
        latitude: 25.6022,
        longitude: 85.1376,
        capacity: null,
        occupied: null,
        facilities: ["Food", "Drinking Water", "Medical Aid"],
        sourceDate: "Patna SAR dataset — bundled shelter",
    },
    {
        id: 2,
        name: "AIIMS Patna Shelter",
        shortName: "AIIMS Patna Shelter",
        location: "AIIMS Campus, Phulwari Sharif, Patna",
        type: "Medical Flood Relief Centre",
        status: "ACTIVE",
        latitude: 25.5605,
        longitude: 85.0410,
        capacity: null,
        occupied: null,
        facilities: ["Food", "Drinking Water", "Medical Aid", "Hospital"],
        sourceDate: "Patna SAR dataset — bundled shelter",
    },
];

function geoJsonToShelters(geojson) {
    return (geojson.features || []).map((f, idx) => ({
        id: idx + 1,
        name: f.properties?.name || `Shelter ${idx + 1}`,
        shortName: f.properties?.name || `Shelter ${idx + 1}`,
        location: f.properties?.location || "Patna, Bihar",
        type: f.properties?.type || "Flood Relief Centre",
        status: f.properties?.status || "ACTIVE",
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
        capacity: f.properties?.capacity || null,
        occupied: f.properties?.occupied || null,
        facilities: f.properties?.facilities || ["Food", "Drinking Water", "Medical Aid"],
        sourceDate: "Bundled Patna shelter dataset",
    }));
}

function ShelterMapController({ shelters }) {
    const map = useMap();

    useEffect(() => {
        if (!shelters.length) {
            return;
        }

        const bounds = shelters.map((shelter) => [
            shelter.latitude,
            shelter.longitude,
        ]);

        map.fitBounds(bounds, {
            padding: [40, 40],
            maxZoom: 14,
        });
    }, [shelters, map]);

    return null;
}

function getDirections(shelter) {
    const destination = `${shelter.latitude},${shelter.longitude}`;

    return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

function Shelters() {
    const [shelters, setShelters] = useState(FALLBACK_SHELTERS);
    const [filter, setFilter] = useState("ALL");
    const [search, setSearch] = useState("");
    const [selectedShelter, setSelectedShelter] = useState(
        FALLBACK_SHELTERS[0]
    );

    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [backendConnected, setBackendConnected] = useState(false);

    const fetchLiveShelters = async (showLoading = true) => {
        if (showLoading) {
            setLoading(true);
        }

        try {
            // 1. Try bundled GeoJSON from backend
            const file = await getBundledShelters();
            const text = await file.text();
            const geojson = JSON.parse(text);
            const mapped = geoJsonToShelters(geojson);

            if (mapped.length > 0) {
                setShelters(mapped);
                setBackendConnected(true);
                setLastUpdated(new Date());
                return;
            }
        } catch {
            // fall through to live API
        }

        try {
            // 2. Try live shelters API
            const data = await getShelters();

            if (data.live && Array.isArray(data.shelters)) {
                setShelters(data.shelters);
                setBackendConnected(true);
                setLastUpdated(new Date());
            } else {
                setShelters(FALLBACK_SHELTERS);
                setBackendConnected(false);
            }
        } catch {
            setShelters(FALLBACK_SHELTERS);
            setBackendConnected(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let current = true;

        const loadShelters = async () => {
            try {
                // 1. Try bundled GeoJSON from backend
                const file = await getBundledShelters();
                const text = await file.text();
                const geojson = JSON.parse(text);
                const mapped = geoJsonToShelters(geojson);

                if (!current) return;

                if (mapped.length > 0) {
                    setShelters(mapped);
                    setBackendConnected(true);
                    setLastUpdated(new Date());
                    setLoading(false);
                    return;
                }
            } catch {
                // fall through to live API
            }

            try {
                const data = await getShelters();

                if (!current) {
                    return;
                }

                if (data.live && Array.isArray(data.shelters)) {
                    setShelters(data.shelters);
                    setBackendConnected(true);
                    setLastUpdated(new Date());
                } else {
                    setShelters(FALLBACK_SHELTERS);
                    setBackendConnected(false);
                }
            } catch {
                if (current) {
                    setShelters(FALLBACK_SHELTERS);
                    setBackendConnected(false);
                }
            } finally {
                if (current) {
                    setLoading(false);
                }
            }
        };

        loadShelters();

        return () => {
            current = false;
        };
    }, []);

    const filteredShelters = shelters.filter((shelter) => {
        const matchesFilter =
            filter === "ALL" ||
            shelter.status === filter;

        const searchText = search.toLowerCase();

        const matchesSearch =
            shelter.name
                .toLowerCase()
                .includes(searchText) ||
            shelter.location
                .toLowerCase()
                .includes(searchText) ||
            shelter.type
                .toLowerCase()
                .includes(searchText);

        return matchesFilter && matchesSearch;
    });

    const activeCount = shelters.filter(
        (shelter) => shelter.status === "ACTIVE"
    ).length;

    const verifyCount = shelters.filter(
        (shelter) => shelter.status === "VERIFY"
    ).length;

    return (
        <div className="shelters-page">

            {/* =====================================================
                PAGE HEADER
            ====================================================== */}

            <div className="dashboard-header">

                <div>
                    <h2>Flood Relief Centres</h2>

                    <p>
                        Find rehabilitation and emergency
                        shelter locations for flood-affected
                        residents in Patna.
                    </p>
                </div>

                <div className={`system-time ${backendConnected ? "is-connected" : "is-verified"}`}>

                    <span
                        className={
                            backendConnected
                                ? "live-dot"
                                : "live-dot warning"
                        }
                    ></span>

                    {backendConnected
                        ? "Live Data Connected"
                        : "Historical Listing Mode"}

                </div>

            </div>

            {/* =====================================================
                LIVE DATA NOTICE
            ====================================================== */}

            <div className="shelter-notice">

                <div className="shelter-notice-icon">
                    {backendConnected
                        ? <Icon name="check" size={18} />
                        : <Icon name="info" size={18} />}
                </div>

                <div>

                    <strong>
                        {backendConnected
                            ? "Live shelter information connected"
                            : "Live shelter status is not currently connected"}
                    </strong>

                    <p>
                        {backendConnected
                            ? "Shelter information below is being supplied by the HydroShield backend."
                            : "Showing bundled Patna flood-relief listings. Current activation and occupancy must be confirmed with local authorities."}
                    </p>

                </div>

                <button
                    className="shelter-refresh-button"
                    onClick={fetchLiveShelters}
                    disabled={loading}
                >
                    {loading
                        ? "Refreshing..."
                        : <><Icon name="refresh" size={16} /> Refresh</>}
                </button>

            </div>

            {/* =====================================================
                STATISTICS
            ====================================================== */}

            <div className="shelter-stats">

                <div className="shelter-stat-card">

                    <div className="shelter-stat-icon available">
                        <Icon name="check" size={19} />
                    </div>

                    <div>
                        <span>Confirmed Active</span>

                        <strong>
                            {activeCount}
                        </strong>
                    </div>

                </div>

                <div className="shelter-stat-card">

                    <div className="shelter-stat-icon total">
                        <Icon name="building" size={19} />
                    </div>

                    <div>
                        <span>Total Centres</span>

                        <strong>
                            {shelters.length}
                        </strong>
                    </div>

                </div>

                <div className="shelter-stat-card">

                    <div className="shelter-stat-icon total">
                        <Icon name="alert" size={19} />
                    </div>

                    <div>
                        <span>Verify Status</span>

                        <strong>
                            {verifyCount}
                        </strong>
                    </div>

                </div>

                <div className="shelter-stat-card">

                    <div className="shelter-stat-icon available">
                        <Icon name="pin" size={19} />
                    </div>

                    <div>
                        <span>City</span>

                        <strong>
                            Patna
                        </strong>
                    </div>

                </div>

            </div>

            {/* =====================================================
                MAP
            ====================================================== */}

            <div className="dashboard-card shelter-map-card">

                <div className="card-header">

                    <div>
                        <h3>
                            Patna Flood Relief Map
                        </h3>

                        <p>
                            Click a marker to view shelter
                            information and directions.
                        </p>
                    </div>

                    <div className="map-live-indicator">

                        <span className="live-dot"></span>

                        {backendConnected
                            ? "Live"
                            : "Historical locations"}

                    </div>

                </div>

                <div className="shelter-map-wrapper">

                    <MapContainer
                        center={[
                            25.59,
                            85.09,
                        ]}
                        zoom={13}
                        scrollWheelZoom={true}
                        className="leaflet-map"
                    >

                        <TileLayer
                            attribution='&copy; OpenStreetMap contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        <ShelterMapController
                            shelters={shelters}
                        />

                        {shelters.map((shelter) => (

                            <CircleMarker
                                key={shelter.id}
                                center={[
                                    shelter.latitude,
                                    shelter.longitude,
                                ]}
                                radius={
                                    selectedShelter?.id ===
                                    shelter.id
                                        ? 11
                                        : 8
                                }
                                pathOptions={{
                                    color: "#ffffff",
                                    weight: 3,
                                    fillColor:
                                        shelter.status ===
                                        "ACTIVE"
                                            ? "#16a765"
                                            : "#e59b20",
                                    fillOpacity: 0.95,
                                }}
                                eventHandlers={{
                                    click: () => {
                                        setSelectedShelter(
                                            shelter
                                        );
                                    },
                                }}
                            >

                                <Popup>

                                    <strong>
                                        {shelter.name}
                                    </strong>

                                    <br />

                                    <span>
                                        {shelter.location}
                                    </span>

                                    <br />
                                    <br />

                                    <strong>
                                        Status:{" "}
                                    </strong>

                                    {shelter.status ===
                                    "ACTIVE"
                                        ? "ACTIVE / LISTED"
                                        : "VERIFY BEFORE USE"}

                                    <br />
                                    <br />

                                    <a
                                        href={getDirections(
                                            shelter
                                        )}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Get Directions
                                    </a>

                                </Popup>

                            </CircleMarker>

                        ))}

                    </MapContainer>

                    <div className="shelter-map-legend">

                        <strong>
                            Shelter Status
                        </strong>

                        <div>
                            <span className="legend-dot active"></span>
                            Listed
                        </div>

                        <div>
                            <span className="legend-dot verify"></span>
                            Verify Before Use
                        </div>

                    </div>

                </div>

            </div>

            {/* =====================================================
                SEARCH + FILTER
            ====================================================== */}

            <div className="dashboard-card shelter-panel">

                <div className="shelter-panel-header">

                    <div>

                        <h3>
                            Flood Relief Centres
                        </h3>

                        <p>Historical locations; confirm availability before travel.</p>

                    </div>

                    <div className="shelter-search">
                        <Icon name="search" size={17} />
                        <input
                            type="text"
                            placeholder="Search centre or area..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>
                </div>

                <div className="shelter-filters">
                    {["ALL", "ACTIVE", "VERIFY"].map((status) => (
                        <button
                            key={status}
                            className={filter === status ? "shelter-filter active" : "shelter-filter"}
                            onClick={() => setFilter(status)}
                        >
                            {status === "VERIFY" ? "VERIFY STATUS" : status}
                        </button>
                    ))}
                </div>

                {/* =================================================
                    SHELTER CARDS
                ================================================== */}

                <div className="shelter-grid">

                    {filteredShelters.map(
                        (shelter) => (

                            <div
                                className="shelter-card"
                                key={shelter.id}
                            >

                                <div className="shelter-card-top">

                                    <div className="shelter-building">
                                        <Icon name="building" size={20} />
                                    </div>

                                    <span
                                        className={`shelter-status ${
                                            shelter.status ===
                                            "ACTIVE"
                                                ? "available"
                                                : "near-capacity"
                                        }`}
                                    >
                                        {shelter.status ===
                                        "ACTIVE"
                                            ? "ACTIVE"
                                            : "VERIFY"}
                                    </span>

                                </div>

                                <h3>
                                    {shelter.name}
                                </h3>

                                <p className="shelter-location">
                                    <Icon name="pin" size={14} />
                                    {shelter.location}
                                </p>

                                <div className="shelter-type">
                                    {shelter.type}
                                </div>

                                {/* Facilities */}

                                <div className="shelter-facilities">

                                    <span>
                                        <Icon name="food" size={14} /> Food
                                    </span>

                                    <span>
                                        <Icon name="droplet" size={14} /> Water
                                    </span>

                                    <span>
                                        <Icon name="medical" size={14} /> Medical
                                    </span>

                                </div>

                                {/* Capacity */}

                                <div className="capacity-section">

                                    <div className="capacity-header">

                                        <span>
                                            Occupancy
                                        </span>

                                        <strong>
                                            {shelter.occupied !=
                                                null &&
                                            shelter.capacity !=
                                                null
                                                ? `${shelter.occupied}/${shelter.capacity}`
                                                : "Live data unavailable"}
                                        </strong>

                                    </div>

                                    {shelter.occupied !=
                                        null &&
                                    shelter.capacity !=
                                        null ? (

                                        <div className="capacity-bar">

                                            <div
                                                className="capacity-fill available"
                                                style={{
                                                    width: `${Math.min(
                                                        (shelter.occupied /
                                                            shelter.capacity) *
                                                            100,
                                                        100
                                                    )}%`,
                                                }}
                                            ></div>

                                        </div>

                                    ) : (

                                        <div className="capacity-unavailable">

                                            <span>
                                                Current occupancy
                                                has not been
                                                provided.
                                            </span>

                                        </div>

                                    )}

                                </div>

                                {/* Source information */}

                                <div className="shelter-source">

                                    <span>
                                        <Icon name="info" size={14} />
                                    </span>

                                    <span>
                                        {shelter.sourceDate ||
                                            "Backend-provided shelter data"}
                                    </span>

                                </div>

                                {/* Actions */}

                                <div className="shelter-actions">

                                    <a
                                        href={getDirections(
                                            shelter
                                        )}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="shelter-map-button"
                                    >
                                        <Icon name="map" size={15} /> Directions
                                    </a>

                                </div>

                            </div>

                        )
                    )}

                </div>

                {/* No results */}

                {filteredShelters.length === 0 && (

                    <div className="no-shelters">

                        <div>
                            <Icon name="search" size={22} />
                        </div>

                        <h3>
                            No relief centres found
                        </h3>

                        <p>
                            Try another location or filter.
                        </p>

                    </div>

                )}

            </div>

            {/* =====================================================
                EMERGENCY CONTACTS
            ====================================================== */}

            <div className="emergency-contact-panel">

                <div>

                    <span className="emergency-icon">
                        <Icon name="alert" size={21} />
                    </span>

                    <div>

                        <strong>Confirm Current Shelter Status</strong>

                        <p>No verified emergency phone contact is configured. Follow current local-authority instructions.</p>

                    </div>

                </div>

            </div>

            {/* Last updated */}

            <div className="shelter-last-updated">

                {lastUpdated
                    ? `Last backend update: ${lastUpdated.toLocaleString()}`
                    : "No live backend update; historical locations are listed for reference"}

            </div>

        </div>
    );
}

export default Shelters;
