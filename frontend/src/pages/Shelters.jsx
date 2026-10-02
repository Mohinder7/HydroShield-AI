import { useEffect, useState } from "react";
import {
    MapContainer,
    TileLayer,
    CircleMarker,
    Popup,
    useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

const FALLBACK_SHELTERS = [
    {
        id: 1,
        name: "Komma Sitaramaiah ZP Girls High School",
        shortName: "KSR ZP Girls High School",
        location: "Patamatalanka, Vijayawada",
        type: "Flood Relief Centre",
        status: "ACTIVE",
        latitude: 16.5052,
        longitude: 80.6379,
        capacity: null,
        occupied: null,
        facilities: [
            "Food",
            "Drinking Water",
            "Medical Aid",
        ],
        sourceDate: "Used during Vijayawada floods – Sep 2024",
    },

    {
        id: 2,
        name: "Valluri Sarojini Devi Municipal Corporation High School",
        shortName: "Valluri Sarojini Devi MC High School",
        location: "Patamata Lanka, Vijayawada",
        type: "Flood Relief Centre",
        status: "ACTIVE",
        latitude: 16.4955,
        longitude: 80.6640,
        capacity: null,
        occupied: null,
        facilities: [
            "Food",
            "Drinking Water",
            "Medical Aid",
        ],
        sourceDate: "Used during Vijayawada floods – Sep 2024",
    },

    {
        id: 3,
        name: "Indira Gandhi Municipal Corporation Stadium",
        shortName: "IGMC Stadium",
        location: "Labbipet, Vijayawada",
        type: "Temporary Flood Relief Centre",
        status: "VERIFY",
        latitude: 16.504628,
        longitude: 80.637957,
        capacity: null,
        occupied: null,
        facilities: [
            "Large Emergency Facility",
            "Relief Support",
        ],
        sourceDate: "Used as flood relief camp – Aug 2020",
    },
];

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

    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [backendConnected, setBackendConnected] = useState(false);

    const fetchLiveShelters = async () => {
        setLoading(true);

        try {
            const apiUrl =
                import.meta.env.VITE_API_URL ||
                "http://localhost:8000/api";

            const response = await fetch(
                `${apiUrl}/shelters`
            );

            if (!response.ok) {
                throw new Error("Shelter API unavailable");
            }

            const data = await response.json();

            if (Array.isArray(data.shelters)) {
                setShelters(data.shelters);
                setBackendConnected(true);
                setLastUpdated(new Date());
            }
        } catch (error) {
            console.log(
                "Live shelter API unavailable. Using verified fallback data."
            );

            setShelters(FALLBACK_SHELTERS);
            setBackendConnected(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLiveShelters();
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
                        residents in Vijayawada.
                    </p>
                </div>

                <div className="system-time">

                    <span
                        className={
                            backendConnected
                                ? "live-dot"
                                : "live-dot warning"
                        }
                    ></span>

                    {backendConnected
                        ? "Live Data Connected"
                        : "Verified Data Mode"}

                </div>

            </div>

            {/* =====================================================
                LIVE DATA NOTICE
            ====================================================== */}

            <div className="shelter-notice">

                <div className="shelter-notice-icon">
                    {backendConnected ? "✓" : "!"}
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
                            : "Showing verified Vijayawada flood-relief locations. Current activation and occupancy must be confirmed with authorities."}
                    </p>

                </div>

                <button
                    className="shelter-refresh-button"
                    onClick={fetchLiveShelters}
                    disabled={loading}
                >
                    {loading
                        ? "Refreshing..."
                        : "↻ Refresh"}
                </button>

            </div>

            {/* =====================================================
                STATISTICS
            ====================================================== */}

            <div className="shelter-stats">

                <div className="shelter-stat-card">

                    <div className="shelter-stat-icon available">
                        ✓
                    </div>

                    <div>
                        <span>Active / Listed</span>

                        <strong>
                            {activeCount}
                        </strong>
                    </div>

                </div>

                <div className="shelter-stat-card">

                    <div className="shelter-stat-icon total">
                        🏠
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
                        ⚠
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
                        📍
                    </div>

                    <div>
                        <span>City</span>

                        <strong>
                            Vijayawada
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
                            Vijayawada Flood Relief Map
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
                            : "Verified locations"}

                    </div>

                </div>

                <div className="shelter-map-wrapper">

                    <MapContainer
                        center={[
                            16.5062,
                            80.6480,
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
                                        🗺️ Get Directions
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
                            Active / Listed
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

                        <p>
                            Emergency locations identified
                            for flood-affected residents.
                        </p>

                    </div>

                    <div className="shelter-search">

                        🔍

                        <input
                            type="text"
                            placeholder="Search centre or area..."
                            value={search}
                            onChange={(event) =>
                                setSearch(
                                    event.target.value
                                )
                            }
                        />

                    </div>

                </div>

                {/* Filters */}

                <div className="shelter-filters">

                    {[
                        "ALL",
                        "ACTIVE",
                        "VERIFY",
                    ].map((status) => (

                        <button
                            key={status}
                            className={
                                filter === status
                                    ? "shelter-filter active"
                                    : "shelter-filter"
                            }
                            onClick={() =>
                                setFilter(status)
                            }
                        >
                            {status === "VERIFY"
                                ? "VERIFY STATUS"
                                : status}
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
                                        🏠
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
                                    📍{" "}
                                    {shelter.location}
                                </p>

                                <div className="shelter-type">
                                    {shelter.type}
                                </div>

                                {/* Facilities */}

                                <div className="shelter-facilities">

                                    <span>
                                        🍱 Food
                                    </span>

                                    <span>
                                        💧 Water
                                    </span>

                                    <span>
                                        🏥 Medical
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
                                        ℹ
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
                                        🗺️ Directions
                                    </a>

                                    <a
                                        href="tel:9154970454"
                                        className="shelter-call-button"
                                    >
                                        📞 Emergency
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
                            🔍
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
                        🚨
                    </span>

                    <div>

                        <strong>
                            Vijayawada Flood Emergency
                        </strong>

                        <p>
                            Contact the district control
                            room to confirm which relief
                            centres are currently activated.
                        </p>

                    </div>

                </div>

                <div className="emergency-buttons">

                    <a
                        href="tel:9154970454"
                        className="emergency-call"
                    >
                        📞 91549 70454
                    </a>

                    <a
                        href="tel:08662422400"
                        className="emergency-vmc"
                    >
                        ☎ VMC
                    </a>

                </div>

            </div>

            {/* Last updated */}

            <div className="shelter-last-updated">

                {lastUpdated
                    ? `Last backend update: ${lastUpdated.toLocaleString()}`
                    : "Live backend update not available — showing verified fallback locations"}

            </div>

        </div>
    );
}

export default Shelters;
