import MapView from "../components/MapView";

function FloodMap() {
    return (
        <div className="flood-map-page">

            <div className="dashboard-header">

                <div>
                    <h2>Flood Risk Monitoring</h2>

                    <p>
                        Interactive visualization of detected
                        flood-risk zones and emergency shelters.
                    </p>
                </div>

                <div className="system-time">
                    <span className="live-dot"></span>
                    Monitoring Active
                </div>

            </div>

            <div className="dashboard-card full-map-card">

                <div className="card-header">

                    <div>
                        <h3>HydroShield Flood Map</h3>

                        <p>
                            Flood detection and emergency
                            infrastructure
                        </p>
                    </div>

                    <div className="map-controls">

                        <button className="map-control active">
                            Flood Risk
                        </button>

                        <button className="map-control">
                            Shelters
                        </button>

                        <button className="map-control">
                            Roads
                        </button>

                    </div>

                </div>

                <MapView />

            </div>

        </div>
    );
}

export default FloodMap;