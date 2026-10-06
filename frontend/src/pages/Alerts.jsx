import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { detectFloodBundled } from "../api";

function generateAlerts(riskLevel, floodPct, floodAreaKm2) {
    const now = new Date();
    const ts = (offset) => new Date(now.getTime() - offset * 60000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const l = (riskLevel || "").toLowerCase();
    const pct = floodPct != null ? `${Number(floodPct).toFixed(1)}%` : "?%";
    const area = floodAreaKm2 != null ? `${Number(floodAreaKm2).toFixed(2)}\u00a0km\u00b2` : "unknown area";

    if (l.includes("high")) {
        return [
            { id: 1, severity: "HIGH", title: "Critical Flood Conditions Detected", description: `SAR analysis of the Patna region shows ${pct} of the monitored area (${area}) is flooded. Immediate evacuation from low-lying areas is advised.`, area: "Patna District", time: ts(2), read: false },
            { id: 2, severity: "HIGH", title: "Flood Water Rising in Low-Lying Areas", description: "Satellite backscatter data indicates rapidly expanding flood zones. Keep emergency contacts ready.", area: "Riverbank Areas", time: ts(7), read: false },
            { id: 3, severity: "MEDIUM", title: "Shelter Advisory Issued", description: `${pct} flood coverage detected. Emergency shelters activated across Patna district. Capacity may be limited — proceed immediately.`, area: "Patna Shelters", time: ts(15), read: false },
            { id: 4, severity: "MEDIUM", title: "Road Network Partially Flooded", description: "Several major road segments are at risk of being impassable. Use the Routing page to calculate a safe evacuation route.", area: "Transport Network", time: ts(22), read: false },
            { id: 5, severity: "LOW", title: "Utility Services Advisory", description: "Power and communication disruptions may occur in flooded zones. Conserve mobile battery; keep emergency radio available.", area: "Patna City", time: ts(35), read: false },
        ];
    } else if (l.includes("moderate")) {
        return [
            { id: 1, severity: "MEDIUM", title: "Moderate Flood Risk Detected", description: `SAR analysis shows ${pct} flood coverage (${area}) in the Patna region. Monitor the situation and prepare an emergency kit.`, area: "Patna District", time: ts(5), read: false },
            { id: 2, severity: "MEDIUM", title: "Precautionary Shelter Advisory", description: "Shelters placed on standby. Check the Shelters page for current listings and directions.", area: "Patna Shelters", time: ts(18), read: false },
            { id: 3, severity: "LOW", title: "Flood Watch: Conditions Worsening", description: "Backscatter values indicate elevated water presence. Situation should be re-analyzed in 6 hours.", area: "Monitored Zone", time: ts(30), read: false },
        ];
    } else {
        return [
            { id: 1, severity: "LOW", title: "Low Flood Risk — Monitoring Active", description: `Current SAR analysis shows ${pct} flood coverage (${area}). Conditions are stable. Continue normal activities while monitoring official channels.`, area: "Patna District", time: ts(10), read: false },
            { id: 2, severity: "LOW", title: "Routine Flood Watch", description: "No emergency conditions detected. Shelters are on standby. Check back after the next satellite pass.", area: "All Zones", time: ts(40), read: false },
        ];
    }
}

function severityIcon(s) {
    if (s === "HIGH") return "alert";
    if (s === "MEDIUM") return "info";
    return "check";
}

function severityClass(s) {
    if (s === "HIGH") return "high";
    if (s === "MEDIUM") return "medium";
    return "low";
}

function Alerts() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState("ALL");

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const data = await detectFloodBundled(1, -17, "dB");
                if (!cancelled) {
                    setAlerts(generateAlerts(data.risk?.level, data.flooded_percentage, data.flooded_area_km2));
                }
            } catch (e) {
                if (!cancelled) setError(e.message || "Could not load flood data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    const dismiss = (id) => setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, read: true } : a));
    const restore = (id) => setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, read: false } : a));

    const visible = alerts.filter((a) => {
        if (filter === "ALL") return !a.read;
        if (filter === "READ") return a.read;
        return !a.read && a.severity === filter;
    });

    const active = alerts.filter((a) => !a.read);
    const high = active.filter((a) => a.severity === "HIGH").length;
    const medium = active.filter((a) => a.severity === "MEDIUM").length;
    const low = active.filter((a) => a.severity === "LOW").length;

    return (
        <div className="alerts-page">
            <div className="dashboard-header">
                <div>
                    <h2>Emergency Alert Center</h2>
                    <p>{loading ? "Generating alerts from SAR analysis..." : error ? "Could not load flood data" : `${active.length} active alert${active.length !== 1 ? "s" : ""} based on Patna SAR analysis`}</p>
                </div>
                <div className="system-time alert-live">
                    <span className="live-dot"></span>
                    {loading ? "Analyzing..." : error ? "Error" : "SAR-Derived Alerts"}
                </div>
            </div>

            <div className="alert-stats">
                <div className="alert-stat-card">
                    <div className="alert-stat-icon total"><Icon name="bell" size={19} /></div>
                    <div><span>Total Active</span><strong>{loading ? "..." : active.length}</strong></div>
                </div>
                <div className="alert-stat-card">
                    <div className="alert-stat-icon high"><Icon name="alert" size={19} /></div>
                    <div><span>High Severity</span><strong>{loading ? "..." : high}</strong></div>
                </div>
                <div className="alert-stat-card">
                    <div className="alert-stat-icon medium"><Icon name="info" size={19} /></div>
                    <div><span>Medium Severity</span><strong>{loading ? "..." : medium}</strong></div>
                </div>
                <div className="alert-stat-card">
                    <div className="alert-stat-icon low"><Icon name="check" size={19} /></div>
                    <div><span>Low Severity</span><strong>{loading ? "..." : low}</strong></div>
                </div>
            </div>

            <div className="dashboard-card alerts-panel">
                <div className="alerts-panel-header">
                    <div>
                        <h3>Emergency Notifications</h3>
                        <p>{loading ? "Loading..." : `Flood-derived alerts for Patna district \u2014 dismiss to mark as read`}</p>
                    </div>
                    <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                        {["ALL", "HIGH", "MEDIUM", "LOW", "READ"].map((f) => (
                            <button
                                key={f}
                                className={`shelter-filter${filter === f ? " active" : ""}`}
                                onClick={() => setFilter(f)}
                            >{f}</button>
                        ))}
                    </div>
                </div>

                <div className="full-alert-list">
                    {loading && <div className="no-alerts"><p>Generating alerts from SAR flood analysis...</p></div>}
                    {!loading && error && <div className="no-alerts"><Icon name="alert" size={22} /><h3>Could not load alerts</h3><p>{error}</p></div>}
                    {!loading && !error && visible.length === 0 && (
                        <div className="no-alerts">
                            <Icon name="check" size={22} />
                            <h3>{filter === "READ" ? "No dismissed alerts" : "No active alerts"}</h3>
                            <p>{filter === "READ" ? "Dismiss alerts to see them here." : "All alerts have been dismissed."}</p>
                        </div>
                    )}
                    {visible.map((alert) => (
                        <div key={alert.id} className={`full-alert-card severity-${severityClass(alert.severity)}${alert.read ? " read" : ""}`}
                            style={{ border: `1px solid ${alert.severity === "HIGH" ? "#fca5a5" : alert.severity === "MEDIUM" ? "#fed7aa" : "#bbf7d0"}`, borderRadius: 10, padding: "16px 20px", marginBottom: 12, background: alert.severity === "HIGH" ? "#fff5f5" : alert.severity === "MEDIUM" ? "#fffbeb" : "#f0fdf4", opacity: alert.read ? 0.55 : 1 }}
                        >
                            <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12}}>
                                <div style={{display: "flex", gap: 10, alignItems: "flex-start"}}>
                                    <div style={{marginTop: 2}}><Icon name={severityIcon(alert.severity)} size={18} /></div>
                                    <div>
                                        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 4}}>
                                            <span className={`shelter-status ${alert.severity === "HIGH" ? "" : alert.severity === "MEDIUM" ? "near-capacity" : "available"}`}
                                                style={{fontSize: "0.7rem", padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: alert.severity === "HIGH" ? "#ef4444" : alert.severity === "MEDIUM" ? "#f97316" : "#22c55e", color: "#fff"}}>
                                                {alert.severity}
                                            </span>
                                            <strong style={{fontSize: "0.95rem"}}>{alert.title}</strong>
                                        </div>
                                        <p style={{fontSize: "0.85rem", color: "#475569", margin: 0}}>{alert.description}</p>
                                        <div style={{marginTop: 8, display: "flex", gap: 16, fontSize: "0.78rem", color: "#94a3b8"}}>
                                            <span><Icon name="pin" size={12} /> {alert.area}</span>
                                            <span>{alert.time}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => alert.read ? restore(alert.id) : dismiss(alert.id)}
                                    style={{background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap"}}
                                    aria-label={alert.read ? "Restore alert" : "Dismiss alert"}
                                >
                                    {alert.read ? "Restore" : "Dismiss"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default Alerts;
