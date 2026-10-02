function Dashboard() {
    const stats = [
        {
            title: "Flood Risk",
            value: "HIGH",
            subtitle: "Current regional risk",
            icon: "⚠️",
            className: "risk-high",
        },
        {
            title: "Flooded Area",
            value: "24.6 km²",
            subtitle: "Detected flood extent",
            icon: "🌊",
            className: "risk-blue",
        },
        {
            title: "Affected Regions",
            value: "12",
            subtitle: "Areas under monitoring",
            icon: "📍",
            className: "risk-orange",
        },
        {
            title: "Safe Shelters",
            value: "18",
            subtitle: "Available shelters",
            icon: "🏠",
            className: "risk-green",
        },
    ];

    const alerts = [
        {
            title: "High Flood Risk Detected",
            location: "Lower Krishna Region",
            time: "12 min ago",
            severity: "HIGH",
        },
        {
            title: "Road Connectivity Alert",
            location: "Riverbank Road",
            time: "28 min ago",
            severity: "MEDIUM",
        },
        {
            title: "Shelter Capacity Update",
            location: "Central Relief Centre",
            time: "42 min ago",
            severity: "LOW",
        },
    ];

    return (
        <div className="dashboard">

            {/* Welcome */}
            <div className="dashboard-header">
                <div>
                    <h2>Disaster Monitoring Overview</h2>

                    <p>
                        Monitor flood conditions, affected areas,
                        emergency alerts and available shelters.
                    </p>
                </div>

                <div className="system-time">
                    <span className="live-dot"></span>
                    System monitoring active
                </div>
            </div>

            {/* Statistics */}
            <div className="stats-grid">
                {stats.map((stat) => (
                    <div
                        className={`stat-card ${stat.className}`}
                        key={stat.title}
                    >
                        <div className="stat-top">
                            <div className="stat-icon">
                                {stat.icon}
                            </div>

                            <span className="stat-menu">⋮</span>
                        </div>

                        <p className="stat-title">
                            {stat.title}
                        </p>

                        <h3>{stat.value}</h3>

                        <span className="stat-subtitle">
                            {stat.subtitle}
                        </span>
                    </div>
                ))}
            </div>

            {/* Main dashboard grid */}
            <div className="dashboard-grid">

                {/* Map */}
                <div className="dashboard-card map-card">

                    <div className="card-header">
                        <div>
                            <h3>Flood Monitoring Map</h3>
                            <p>
                                Current flood-risk overview
                            </p>
                        </div>

                        <button className="view-button">
                            View Full Map →
                        </button>
                    </div>

                    <div className="map-placeholder">

                        <div className="map-grid"></div>

                        <div className="map-water water-one"></div>
                        <div className="map-water water-two"></div>

                        <div className="map-point point-one">
                            <span></span>
                            <label>High Risk</label>
                        </div>

                        <div className="map-point point-two">
                            <span></span>
                            <label>Medium Risk</label>
                        </div>

                        <div className="map-point point-three">
                            <span></span>
                            <label>Safe</label>
                        </div>

                        <div className="map-label">
                            HYDROSHIELD FLOOD MONITORING
                        </div>

                    </div>

                    <div className="map-legend">

                        <div>
                            <span className="legend-dot high"></span>
                            High Risk
                        </div>

                        <div>
                            <span className="legend-dot medium"></span>
                            Medium Risk
                        </div>

                        <div>
                            <span className="legend-dot low"></span>
                            Low Risk
                        </div>

                    </div>
                </div>

                {/* Alerts */}
                <div className="dashboard-card alerts-card">

                    <div className="card-header">
                        <div>
                            <h3>Recent Alerts</h3>
                            <p>
                                Latest system notifications
                            </p>
                        </div>

                        <button className="view-button">
                            View All
                        </button>
                    </div>

                    <div className="alerts-list">

                        {alerts.map((alert) => (
                            <div
                                className="alert-item"
                                key={alert.title}
                            >
                                <div className="alert-icon">
                                    ⚠
                                </div>

                                <div className="alert-content">
                                    <strong>
                                        {alert.title}
                                    </strong>

                                    <span>
                                        {alert.location}
                                    </span>

                                    <small>
                                        {alert.time}
                                    </small>
                                </div>

                                <span
                                    className={`severity ${alert.severity.toLowerCase()}`}
                                >
                                    {alert.severity}
                                </span>
                            </div>
                        ))}

                    </div>
                </div>
            </div>

            {/* Bottom section */}
            <div className="bottom-grid">

                {/* AI Status */}
                <div className="dashboard-card ai-card">

                    <div className="ai-icon">
                        ✦
                    </div>

                    <div>
                        <span className="section-label">
                            AI ANALYSIS
                        </span>

                        <h3>
                            Flood prediction engine active
                        </h3>

                        <p>
                            HydroShield AI is monitoring satellite
                            imagery and flood-risk indicators.
                        </p>
                    </div>

                    <div className="ai-status">
                        <span></span>
                        Active
                    </div>

                </div>

                {/* Shelter */}
                <div className="dashboard-card shelter-summary">

                    <div className="card-header">
                        <div>
                            <h3>Emergency Shelters</h3>
                            <p>
                                Current availability
                            </p>
                        </div>
                    </div>

                    <div className="shelter-stat">
                        <div>
                            <strong>18</strong>
                            <span>Available</span>
                        </div>

                        <div>
                            <strong>6</strong>
                            <span>Near capacity</span>
                        </div>

                        <div>
                            <strong>2</strong>
                            <span>Full</span>
                        </div>
                    </div>

                </div>

            </div>

        </div>
    );
}

export default Dashboard;