import { useEffect, useState } from "react";
import {
    MapContainer,
    TileLayer,
    Rectangle,
    CircleMarker,
    Popup,
    useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { detectFloodBundled, detectFloodPretrainedBundled, getBundledShelters } from "../api";
import Icon from "../components/Icon";

// Raster coverage centre: Bihar/Gaya region
const PATNA_CENTER = [24.647, 83.903];
// Bounding box of the actual SAR raster
const FLOOD_BOUNDS = [[24.15, 83.27], [25.14, 84.53]];

function riskColor(level) {
    if (!level) return "#64748b";
    const l = level.toLowerCase();
    if (l.includes("high")) return "#ef4444";
    if (l.includes("moderate")) return "#f97316";
    return "#22c55e";
}

function FitBounds({ floodData }) {
    const map = useMap();
    useEffect(() => {
        if (floodData) {
            map.fitBounds(FLOOD_BOUNDS, { padding: [40, 40] });
        }
    }, [floodData, map]);
    return null;
}

export default function FloodMap() {
    const [floodData, setFloodData] = useState(null);
    const [shelters, setShelters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [method, setMethod] = useState("threshold"); // "threshold" | "pretrained"

    async function runDetection(selectedMethod) {
        setLoading(true);
        setError(null);
        setFloodData(null);
        try {
            const data = selectedMethod === "pretrained"
                ? await detectFloodPretrainedBundled(1, "dB")
                : await detectFloodBundled(1, -17, "dB");
            setFloodData(data);
        } catch (e) {
            setError(e.message || "Could not load flood data.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        async function loadAll() {
            try {
                // Load shelters (non-fatal)
                try {
                    const sf = await getBundledShelters();
                    const txt = await sf.text();
                    const gj = JSON.parse(txt);
                    const parsed = (gj.features || []).map((f, i) => ({
                        id: i,
                        name: f.properties?.name || `Shelter ${i + 1}`,
                        lat: f.geometry.coordinates[1],
                        lng: f.geometry.coordinates[0],
                    }));
                    if (!cancelled) setShelters(parsed);
                } catch { /* non-fatal */ }

                // Initial flood detection
                const data = await detectFloodBundled(1, -17, "dB");
                if (!cancelled) setFloodData(data);
            } catch (e) {
                if (!cancelled) setError(e.message || "Could not load flood data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        loadAll();
        return () => { cancelled = true; };
    }, []);

    const riskLevel = floodData?.risk?.level || null;
    const riskCol = riskColor(riskLevel);

    return (
        <div className="flood-map-page">
            <div className="dashboard-header">
                <div>
                    <h2>Flood Risk Monitoring</h2>
                    <p>{loading ? "Loading SAR flood analysis..." : riskLevel ? `Risk Level: ${riskLevel}` : error || "Analysis complete"}</p>
                </div>
                <div className="system-time">
                    <span className="live-dot"></span>
                    {loading ? "Analyzing..." : riskLevel || "No risk data"}
                </div>
            </div>

            {/* Detection method toggle */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                <button
                    className={`btn${method === "threshold" ? " btn-primary" : " btn-secondary"}`}
                    onClick={() => { setMethod("threshold"); runDetection("threshold"); }}
                    disabled={loading}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                    <Icon name="filter" size={14} />
                    SAR Threshold
                </button>
                <button
                    className={`btn${method === "pretrained" ? " btn-primary" : " btn-secondary"}`}
                    onClick={() => { setMethod("pretrained"); runDetection("pretrained"); }}
                    disabled={loading}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                    <Icon name="cpu" size={14} />
                    Pretrained Random Forest
                </button>
            </div>

            {error && (
                <div className="analytics-error" style={{marginBottom: 16}}>
                    <Icon name="alert" size={16} /> {error}
                </div>
            )}

            <div className="dashboard-card full-map-card">
                <div className="card-header">
                    <div>
                        <h3>HydroShield Flood Map — Patna, Bihar</h3>
                        <p>SAR-derived flood extent with shelter locations</p>
                    </div>
                    <div className="map-controls">
                        {loading && <span>Loading flood overlay...</span>}
                        {!loading && riskLevel && (
                            <span style={{color: riskCol, fontWeight: 600}}>{riskLevel}</span>
                        )}
                    </div>
                </div>

                <div style={{position: "relative"}}>
                    <MapContainer center={PATNA_CENTER} zoom={11} scrollWheelZoom={true} className="leaflet-map" style={{height: 500}}>
                        <TileLayer
                            attribution='&copy; OpenStreetMap contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        <FitBounds floodData={floodData} />

                        {/* Flood extent rectangle */}
                        {floodData && (
                            <Rectangle
                                bounds={FLOOD_BOUNDS}
                                pathOptions={{color: riskCol,
                                    weight: 3,
                                    fillColor: riskCol,
                                    fillOpacity: 0.2,
                                    dashArray: riskLevel?.toLowerCase().includes("high") ? undefined : "8 4",}}
                            >
                                <Popup>
                                    <strong>Flood Analysis Zone</strong><br />
                                    <span>Risk: <b>{riskLevel || "Unknown"}</b></span><br />
                                    {floodData.flooded_area_km2 != null && <span>{Number(floodData.flooded_area_km2).toFixed(2)} km&#178; flooded<br /></span>}
                                    {floodData.flooded_percentage != null && <span>{Number(floodData.flooded_percentage).toFixed(1)}% of area<br /></span>}
                                    <small>SAR threshold detection · Patna SAR dataset</small>
                                </Popup>
                            </Rectangle>
                        )}

                        {/* Shelter markers */}
                        {shelters.map((s) => (
                            <CircleMarker
                                key={s.id}
                                center={[s.lat, s.lng]}
                                radius={10}
                                pathOptions={{color: "#fff", weight: 2, fillColor: "#16a765", fillOpacity: 0.95}}
                            >
                                <Popup>
                                    <strong>{s.name}</strong><br />
                                    <span>Emergency Shelter</span><br />
                                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">Get Directions</a>
                                </Popup>
                            </CircleMarker>
                        ))}
                    </MapContainer>

                    {/* Legend */}
                    <div className="map-overlay-legend" style={{position: "absolute", bottom: 24, right: 12, zIndex: 1000, background: "rgba(255,255,255,0.95)", borderRadius: 8, padding: "12px 16px", minWidth: 170, boxShadow: "0 2px 8px rgba(0,0,0,0.15)"}}>
                        <strong style={{display: "block", marginBottom: 8, fontSize: "0.8rem"}}>Flood Risk Legend</strong>
                        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 4}}>
                            <span style={{width: 18, height: 12, background: "#ef4444", borderRadius: 2, display: "inline-block"}}></span>
                            <span style={{fontSize: "0.8rem"}}>High Risk</span>
                        </div>
                        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 4}}>
                            <span style={{width: 18, height: 12, background: "#f97316", borderRadius: 2, display: "inline-block"}}></span>
                            <span style={{fontSize: "0.8rem"}}>Moderate Risk</span>
                        </div>
                        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 8}}>
                            <span style={{width: 18, height: 12, background: "#22c55e", borderRadius: 2, display: "inline-block"}}></span>
                            <span style={{fontSize: "0.8rem"}}>Low Risk</span>
                        </div>
                        <div style={{display: "flex", alignItems: "center", gap: 8}}>
                            <span style={{width: 14, height: 14, background: "#16a765", borderRadius: "50%", display: "inline-block", border: "2px solid #fff", boxShadow: "0 0 0 1px #16a765"}}></span>
                            <span style={{fontSize: "0.8rem"}}>Emergency Shelter</span>
                        </div>
                    </div>

                    {loading && (
                        <div style={{position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.7)", zIndex: 500, borderRadius: 8}}>
                            <div style={{textAlign: "center"}}>
                                <div className="loading-spinner" style={{margin: "0 auto 12px"}}></div>
                                <span>Loading SAR flood analysis...</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Stats bar below map */}
                {floodData && (
                    <div style={{display: "flex", gap: 24, padding: "16px 20px", borderTop: "1px solid #e2e8f0", flexWrap: "wrap"}}>
                        <div><span style={{fontSize: "0.75rem", color: "#64748b"}}>Method</span><br /><strong style={{fontSize: "0.9rem"}}>{method === "pretrained" ? "Pretrained Random Forest" : "SAR Threshold (-17 dB)"}</strong></div>
                        {floodData.flooded_area_km2 != null && <div><span style={{fontSize: "0.75rem", color: "#64748b"}}>Flooded Area</span><br /><strong style={{fontSize: "0.9rem"}}>{Number(floodData.flooded_area_km2).toFixed(2)} km&#178;</strong></div>}
                        {floodData.flooded_percentage != null && <div><span style={{fontSize: "0.75rem", color: "#64748b"}}>Flood Coverage</span><br /><strong style={{fontSize: "0.9rem"}}>{Number(floodData.flooded_percentage).toFixed(1)}%</strong></div>}
                        <div><span style={{fontSize: "0.75rem", color: "#64748b"}}>Risk Level</span><br /><strong style={{fontSize: "0.9rem", color: riskCol}}>{riskLevel || "—"}</strong></div>
                        <div><span style={{fontSize: "0.75rem", color: "#64748b"}}>Shelters Shown</span><br /><strong style={{fontSize: "0.9rem"}}>{shelters.length}</strong></div>
                    </div>
                )}
            </div>
        </div>
    );
}
