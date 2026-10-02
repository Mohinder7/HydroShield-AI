import {
    MapContainer,
    TileLayer,
    Circle,
    CircleMarker,
    Popup,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

function MapView() {
    const center = [16.5062, 80.648];

    const floodZones = [
        {
            name: "High Risk Zone",
            position: [16.515, 80.635],
            radius: 900,
            color: "#e5484d",
            fillOpacity: 0.35,
            risk: "HIGH",
        },
        {
            name: "Medium Risk Zone",
            position: [16.495, 80.665],
            radius: 700,
            color: "#e58a25",
            fillOpacity: 0.3,
            risk: "MEDIUM",
        },
        {
            name: "Low Risk Zone",
            position: [16.525, 80.675],
            radius: 500,
            color: "#22a862",
            fillOpacity: 0.25,
            risk: "LOW",
        },
    ];

    const shelters = [
        {
            name: "Central Relief Shelter",
            position: [16.510, 80.650],
            capacity: "82%",
        },
        {
            name: "Community Emergency Centre",
            position: [16.488, 80.642],
            capacity: "54%",
        },
        {
            name: "Safe Zone Shelter",
            position: [16.530, 80.660],
            capacity: "31%",
        },
    ];

    return (
        <div className="map-wrapper">

            <MapContainer
                center={center}
                zoom={13}
                scrollWheelZoom={true}
                className="leaflet-map"
            >

                <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Flood Zones */}

                {floodZones.map((zone) => (
                    <Circle
                        key={zone.name}
                        center={zone.position}
                        radius={zone.radius}
                        pathOptions={{
                            color: zone.color,
                            fillColor: zone.color,
                            fillOpacity: zone.fillOpacity,
                            weight: 2,
                        }}
                    >
                        <Popup>
                            <strong>{zone.name}</strong>
                            <br />
                            Risk Level: {zone.risk}
                        </Popup>
                    </Circle>
                ))}

                {/* Flood Detection Points */}

                {floodZones.map((zone) => (
                    <CircleMarker
                        key={`${zone.name}-marker`}
                        center={zone.position}
                        radius={8}
                        pathOptions={{
                            color: "white",
                            weight: 2,
                            fillColor: zone.color,
                            fillOpacity: 1,
                        }}
                    >
                        <Popup>
                            <strong>
                                Flood Detection
                            </strong>

                            <br />

                            {zone.name}

                            <br />

                            Risk: {zone.risk}
                        </Popup>
                    </CircleMarker>
                ))}

                {/* Shelters */}

                {shelters.map((shelter) => (
                    <CircleMarker
                        key={shelter.name}
                        center={shelter.position}
                        radius={7}
                        pathOptions={{
                            color: "white",
                            weight: 2,
                            fillColor: "#1687d9",
                            fillOpacity: 1,
                        }}
                    >
                        <Popup>
                            <strong>
                                🏠 {shelter.name}
                            </strong>

                            <br />

                            Current Capacity:{" "}
                            {shelter.capacity}
                        </Popup>
                    </CircleMarker>
                ))}

            </MapContainer>

            {/* Map Legend */}

            <div className="map-overlay-legend">

                <strong>Flood Risk</strong>

                <div>
                    <span className="legend-color high"></span>
                    High Risk
                </div>

                <div>
                    <span className="legend-color medium"></span>
                    Medium Risk
                </div>

                <div>
                    <span className="legend-color low"></span>
                    Low Risk
                </div>

                <div>
                    <span className="legend-color shelter"></span>
                    Shelter
                </div>

            </div>

        </div>
    );
}

export default MapView;