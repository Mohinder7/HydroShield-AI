import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { detectFlood, getBundledRaster, getBundledShelters } from "../api";
import {
    MapContainer,
    TileLayer,
    Rectangle,
    Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const PATNA_CENTER = [25.59, 85.09];

function riskColor(level) {
    if (!level) return "#64748b";
    const l = level.toLowerCase();
    if (l.includes("high")) return "#ef4444";
    if (l.includes("moderate")) return "#f97316";
    return "#22c55e";
}

function generateAlerts(riskLevel, floodPct, floodAreaKm2) {
    const now = new Date();
    const ts = (offset) =>
        new Date(now.getTime() - offset * 60000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    const alerts = [];
    const l = (riskLevel || "").toLowerCase();

    if (l.includes("high")) {
        alerts.push({
            id: 1,
            severity: "HIGH",
            title: "Critical Flood Conditions Detected",
            description: `SAR analysis shows ${floodPct?.toFixed(1) || "?"}% of the monitored area is flooded (${floodAreaKm2?.toFixed(2) || "?"}\u00a0km\u00b2). Immediate evacuation advisory.`,
            time: ts(2),
        });
        alerts.push({
            id: 2,
            severity: "MEDIUM",
            title: "Shelter Advisory Issued",
            description:
                "Emergency shelters activated across Patna district. Check Shelters page for locations.",
            time: ts(8),
        });
        alerts.push({
            id: 3,
            severity: "LOW",
            title: "Road Network Impact Detected",
            description:
                "Several road segments may be flooded. Use the Routing page to find safe routes.",
            time: ts(15),
        });
    } else if (l.includes("moderate")) {
        alerts.push({
            id: 1,
            severity: "MEDIUM",
            title: "Moderate Flood Risk Detected",
            description: `${floodPct?.toFixed(1) || "?"}% of the monitored area shows flood conditions. Monitor situation closely.`,
            time: ts(5),
        });
        alerts.push({
            id: 2,
            severity: "LOW",
            title: "Precautionary Shelter Advisory",
            description:
                "Shelters placed on standby. Check Shelters page for current listings.",
            time: ts(20),
        });
    } else {
        alerts.push({
            id: 1,
            severity: "LOW",
            title: "Low Flood Risk \u2014 Monitoring Active",
            description: `Current analysis shows ${floodPct?.toFixed(1) || "?"}% flood coverage. Conditions are stable.`,
            time: ts(10),
        });
    }
    return alerts;
}

function severityClass(s) {
    if (s === "HIGH") return "alert-high";
    if (s === "MEDIUM") return "alert-medium";
    return "alert-low";
}

function Dashboard({ onNavigate }) {
    const [floodData, setFloodData] = useState(null);
    const [shelterCount, setShelterCount] = useState(null);
    const [loadingFlood, setLoadingFlood] = useState(true);
    const [floodError, setFloodError] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [dismissedIds, setDismissedIds] = useState(new Set());

    useEffect(() => {
        let cancelled = false;

        async function loadData() {
            // Load shelter count — getBundledShelters returns a File (Blob subclass)
            try {
                const shelterFile = await getBundledShelters();
                const text = await shelterFile.text();
                const gj = JSON.parse(text);
                if (!cancelled) setShelterCount(gj.features?.length ?? 0);
            } catch {
                if (!cancelled) setShelterCount(null);
            }

            // Load flood data
            try {
                const rasterFile = await getBundledRaster();
                const data = await detectFlood(rasterFile, 1, -17, "dB");
                if (!cancelled) {
                    setFloodData(data);
                    setAlerts(
                        generateAlerts(
                            data.risk?.level,
                            data.flooded_percentage,
                            data.flooded_area_km2
                        )
                    );
                }
            } catch (e) {
                if (!cancelled)
                    setFloodError(e.message || "Could not run flood analysis.");
            } finally {
                if (!cancelled) setLoadingFlood(false);
            }
        }

        loadData();
        return () => {
            cancelled = true;
        };
    }, []);

    const riskLevel = floodData?.risk?.level || null;
    const riskCol = riskColor(riskLevel);

    const stats = [
        {
            title: "Flood Risk",
            value: loadingFlood ? "..." : riskLevel || "—",
            subtitle: loadingFlood
                ? "Loading..."
                : floodError
                ? "Analysis failed"
                : "Patna SAR analysis",
            icon: "alert",
            className:
                !loadingFlood && riskLevel?.toLowerCase().includes("high")
                    ? "risk-high"
                    : "risk-blue",
        },
        {
            title: "Flooded Area",
            value: loadingFlood
                ? "..."
                : floodData?.flooded_area_km2 != null
                ? `${Number(floodData.flooded_area_km2).toFixed(2)}\u00a0km\u00b2`
                : "—",
            subtitle: loadingFlood
                ? "Loading..."
                : floodData?.flooded_percentage != null
                ? `${Number(floodData.flooded_percentage).toFixed(1)}% of valid area`
                : "Area unavailable",
            icon: "droplet",
            className: "risk-blue",
        },
        {
            title: "Affected Regions",
            value: loadingFlood ? "..." : riskLevel ? "Patna" : "—",
            subtitle: loadingFlood
                ? "Loading..."
                : riskLevel
                ? "Patna district, Bihar"
                : "No analysis",
            icon: "pin",
            className: "risk-orange",
        },
        {
            title: "Safe Shelters",
            value: shelterCount != null ? String(shelterCount) : "—",
            subtitle:
                shelterCount != null
                    ? "Patna emergency shelters"
                    : "Loading shelters...",
            icon: "building",
            className: "risk-green",
        },
    ];

    const visibleAlerts = alerts.filter((a) => !dismissedIds.has(a.id));

    // Approximate Patna SAR dataset bounding box
    const floodBounds = [
        [25.49, 84.95],
        [25.72, 85.28],
    ];

    return (
        <div className="dashboard">
            <div className="dashboard-header">
                <div>
                    <h2>Disaster Monitoring Overview</h2>
                    <p>Live flood analysis from bundled Patna SAR dataset.</p>
                </div>
                <div className="system-time">
                    <span className="live-dot"></span>
                    {loadingFlood
                        ? "Analyzing SAR data..."
                        : riskLevel
                        ? `Risk: ${riskLevel}`
                        : "Analysis ready"}
                </div>
            </div>

            <div className="stats-grid">
                {stats.map((stat) => (
                    <div
                        className={`stat-card ${stat.className}`}
                        key={stat.title}
                    >
                        <div className="stat-top">
                            <div className="stat-icon">
                                <Icon name={stat.icon} size={20} />
                            </div>
                        </div>
                        <p className="stat-title">{stat.title}</p>
                        <h3>{stat.value}</h3>
                        <span className="stat-subtitle">{stat.subtitle}</span>
                    </div>
                ))}
            </div>

            <div className="dashboard-grid">
                {/* Map card */}
                <div className="dashboard-card map-card">
                    <div className="card-header">
                        <div>
                            <h3>Flood Monitoring Map</h3>
                            <p>
                                {loadingFlood
                                    ? "Loading flood data..."
                                    : riskLevel
                                    ? `Risk: ${riskLevel}`
                                    : "Patna, Bihar"}
                            </p>
                        </div>
                        <button
                            className="view-button"
                            onClick={() => onNavigate("Flood Map")}
                        >
                            View Full Map
                        </button>
                    </div>
                    <div
                        className="map-placeholder"
                        style={{ height: 260, position: "relative" }}
                    >
                        <MapContainer
                            center={PATNA_CENTER}
                            zoom={11}
                            scrollWheelZoom={false}
                            style={{ width: "100%", height: "100%" }}
                        >
                            <TileLayer
                                attribution="&copy; OpenStreetMap contributors"
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            {floodData && (
                                <Rectangle
                                    bounds={floodBounds}
                                    pathOptions={{
                                        color: riskCol,
                                        weight: 2,
                                        fillColor: riskCol,
                                        fillOpacity: 0.25,
                                    }}
                                >
                                    <Popup>
                                        <strong>{riskLevel || "Flood Zone"}</strong>
                                        <br />
                                        {floodData.flooded_area_km2 != null
                                            ? `${Number(
                                                  floodData.flooded_area_km2
                                              ).toFixed(2)} km\u00b2 flooded`
                                            : ""}
                                        <br />
                                        {floodData.flooded_percentage != null
                                            ? `${Number(
                                                  floodData.flooded_percentage
                                              ).toFixed(1)}% of area`
                                            : ""}
                                    </Popup>
                                </Rectangle>
                            )}
                        </MapContainer>
                        {loadingFlood && (
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "rgba(255,255,255,0.7)",
                                    zIndex: 500,
                                }}
                            >
                                <span>Loading flood data...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Alerts card */}
                <div className="dashboard-card alerts-card">
                    <div className="card-header">
                        <div>
                            <h3>Recent Alerts</h3>
                            <p>
                                {visibleAlerts.length} active alert
                                {visibleAlerts.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        <button
                            className="view-button"
                            onClick={() => onNavigate("Alerts")}
                        >
                            View All
                        </button>
                    </div>
                    <div className="alerts-list">
                        {visibleAlerts.length === 0 && !loadingFlood && (
                            <p>No active alerts.</p>
                        )}
                        {loadingFlood && <p>Generating alerts...</p>}
                        {visibleAlerts.slice(0, 3).map((a) => (
                            <div
                                key={a.id}
                                className={`alert-item ${severityClass(a.severity)}`}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "flex-start",
                                    }}
                                >
                                    <div>
                                        <span
                                            className={`alert-badge ${severityClass(
                                                a.severity
                                            )}`}
                                        >
                                            {a.severity}
                                        </span>
                                        <strong
                                            style={{
                                                marginLeft: 8,
                                                fontSize: "0.9rem",
                                            }}
                                        >
                                            {a.title}
                                        </strong>
                                    </div>
                                    <button
                                        onClick={() =>
                                            setDismissedIds(
                                                (prev) =>
                                                    new Set([...prev, a.id])
                                            )
                                        }
                                        style={{
                                            background: "none",
                                            border: "none",
                                            cursor: "pointer",
                                            fontSize: "1rem",
                                            color: "#94a3b8",
                                        }}
                                        aria-label="Dismiss alert"
                                    >
                                        &times;
                                    </button>
                                </div>
                                <p
                                    style={{
                                        fontSize: "0.8rem",
                                        color: "#64748b",
                                        marginTop: 4,
                                    }}
                                >
                                    {a.description}
                                </p>
                                <small style={{ color: "#94a3b8" }}>
                                    {a.time}
                                </small>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bottom-grid">
                <div className="dashboard-card ai-card">
                    <div className="ai-icon">
                        <Icon name="layers" size={24} />
                    </div>
                    <div>
                        <span className="section-label">FLOOD ANALYSIS</span>
                        <h3>
                            {loadingFlood
                                ? "Analyzing bundled SAR data..."
                                : riskLevel
                                ? `Current risk: ${riskLevel}`
                                : "Analysis complete"}
                        </h3>
                        <p>
                            {floodData
                                ? `${Number(
                                      floodData.flooded_percentage || 0
                                  ).toFixed(
                                      1
                                  )}% flood coverage detected in Patna SAR image.`
                                : floodError ||
                                  "Auto-analyzing bundled Patna SAR raster on startup."}
                        </p>
                    </div>
                    <div className="ai-status">
                        <span></span>Auto-analyzed
                    </div>
                </div>

                <div className="dashboard-card shelter-summary">
                    <div className="card-header">
                        <div>
                            <h3>Emergency Shelters</h3>
                            <p>Patna district shelters</p>
                        </div>
                    </div>
                    <div className="shelter-stat">
                        <div>
                            <strong>
                                {shelterCount != null ? shelterCount : "—"}
                            </strong>
                            <span>Listed</span>
                        </div>
                        <div>
                            <strong>—</strong>
                            <span>Near capacity</span>
                        </div>
                        <div>
                            <strong>—</strong>
                            <span>Full</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
