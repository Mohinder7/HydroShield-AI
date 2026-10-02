import { useState } from "react";

function Alerts() {
    const [filter, setFilter] = useState("ALL");

    const [alerts, setAlerts] = useState([
        {
            id: 1,
            title: "High Flood Risk Detected",
            description:
                "Satellite-based analysis indicates a high flood-risk region requiring immediate monitoring.",
            location: "Lower Krishna Region",
            time: "12 minutes ago",
            severity: "HIGH",
            status: "ACTIVE",
        },
        {
            id: 2,
            title: "Road Connectivity Alert",
            description:
                "Flood conditions may affect road accessibility in the monitored region.",
            location: "Riverbank Road",
            time: "28 minutes ago",
            severity: "MEDIUM",
            status: "ACTIVE",
        },
        {
            id: 3,
            title: "Shelter Capacity Warning",
            description:
                "One emergency shelter is approaching its current capacity limit.",
            location: "Central Relief Centre",
            time: "42 minutes ago",
            severity: "MEDIUM",
            status: "ACTIVE",
        },
        {
            id: 4,
            title: "Water Level Advisory",
            description:
                "Water-level monitoring indicates a change requiring continued observation.",
            location: "Northern Monitoring Zone",
            time: "1 hour ago",
            severity: "LOW",
            status: "ACTIVE",
        },
        {
            id: 5,
            title: "Flood Detection Update",
            description:
                "New flood classification results have been generated for the monitored area.",
            location: "Eastern Zone",
            time: "1 hour ago",
            severity: "LOW",
            status: "ACTIVE",
        },
    ]);

    const filteredAlerts =
        filter === "ALL"
            ? alerts
            : alerts.filter((alert) => alert.severity === filter);

    const acknowledgeAlert = (id) => {
        setAlerts((currentAlerts) =>
            currentAlerts.map((alert) =>
                alert.id === id
                    ? { ...alert, status: "ACKNOWLEDGED" }
                    : alert
            )
        );
    };

    const activeCount = alerts.filter(
        (alert) => alert.status === "ACTIVE"
    ).length;

    const highCount = alerts.filter(
        (alert) =>
            alert.severity === "HIGH" &&
            alert.status === "ACTIVE"
    ).length;

    const mediumCount = alerts.filter(
        (alert) =>
            alert.severity === "MEDIUM" &&
            alert.status === "ACTIVE"
    ).length;

    const lowCount = alerts.filter(
        (alert) =>
            alert.severity === "LOW" &&
            alert.status === "ACTIVE"
    ).length;

    return (
        <div className="alerts-page">

            {/* Header */}

            <div className="dashboard-header">

                <div>
                    <h2>Emergency Alert Center</h2>

                    <p>
                        Monitor and manage flood-related emergency
                        notifications.
                    </p>
                </div>

                <div className="system-time alert-live">
                    <span className="live-dot"></span>
                    Live Monitoring
                </div>

            </div>

            {/* Alert statistics */}

            <div className="alert-stats">

                <div className="alert-stat-card">
                    <div className="alert-stat-icon total">
                        🔔
                    </div>

                    <div>
                        <span>Total Active</span>
                        <strong>{activeCount}</strong>
                    </div>
                </div>

                <div className="alert-stat-card">
                    <div className="alert-stat-icon high">
                        ⚠
                    </div>

                    <div>
                        <span>High Severity</span>
                        <strong>{highCount}</strong>
                    </div>
                </div>

                <div className="alert-stat-card">
                    <div className="alert-stat-icon medium">
                        !
                    </div>

                    <div>
                        <span>Medium Severity</span>
                        <strong>{mediumCount}</strong>
                    </div>
                </div>

                <div className="alert-stat-card">
                    <div className="alert-stat-icon low">
                        ✓
                    </div>

                    <div>
                        <span>Low Severity</span>
                        <strong>{lowCount}</strong>
                    </div>
                </div>

            </div>

            {/* Alerts panel */}

            <div className="dashboard-card alerts-panel">

                <div className="alerts-panel-header">

                    <div>
                        <h3>Emergency Notifications</h3>

                        <p>
                            Latest alerts generated by the
                            monitoring system
                        </p>
                    </div>

                    <div className="alert-filters">

                        {["ALL", "HIGH", "MEDIUM", "LOW"].map(
                            (level) => (
                                <button
                                    key={level}
                                    className={
                                        filter === level
                                            ? "alert-filter active"
                                            : "alert-filter"
                                    }
                                    onClick={() =>
                                        setFilter(level)
                                    }
                                >
                                    {level}
                                </button>
                            )
                        )}

                    </div>

                </div>

                {/* Alert list */}

                <div className="full-alert-list">

                    {filteredAlerts.length === 0 && (
                        <div className="no-alerts">
                            <div>✓</div>
                            <h3>No alerts found</h3>
                            <p>
                                There are no alerts matching
                                this filter.
                            </p>
                        </div>
                    )}

                    {filteredAlerts.map((alert) => (
                        <div
                            className={`full-alert-item ${alert.severity.toLowerCase()}`}
                            key={alert.id}
                        >

                            <div
                                className={`full-alert-icon ${alert.severity.toLowerCase()}`}
                            >
                                {alert.severity === "HIGH"
                                    ? "⚠"
                                    : alert.severity === "MEDIUM"
                                    ? "!"
                                    : "✓"}
                            </div>

                            <div className="full-alert-content">

                                <div className="alert-title-row">

                                    <h3>{alert.title}</h3>

                                    <span
                                        className={`severity ${alert.severity.toLowerCase()}`}
                                    >
                                        {alert.severity}
                                    </span>

                                </div>

                                <p>
                                    {alert.description}
                                </p>

                                <div className="alert-meta">

                                    <span>
                                        📍 {alert.location}
                                    </span>

                                    <span>
                                        🕒 {alert.time}
                                    </span>

                                </div>

                            </div>

                            <div className="alert-action">

                                {alert.status === "ACTIVE" ? (
                                    <button
                                        className="acknowledge-button"
                                        onClick={() =>
                                            acknowledgeAlert(
                                                alert.id
                                            )
                                        }
                                    >
                                        Acknowledge
                                    </button>
                                ) : (
                                    <span className="acknowledged">
                                        ✓ Acknowledged
                                    </span>
                                )}

                            </div>

                        </div>
                    ))}

                </div>

            </div>

        </div>
    );
}

export default Alerts;