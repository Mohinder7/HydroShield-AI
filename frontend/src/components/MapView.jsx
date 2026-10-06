import { MapContainer, TileLayer } from "react-leaflet";

import "leaflet/dist/leaflet.css";

function MapView() {
    // Bihar/Gaya region — matches SAR raster coverage
    const center = [24.647, 83.903];

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

            </MapContainer>

                <div className="map-overlay-legend">
                    <strong>No flood or shelter layer loaded</strong>
                    <span>Analyze a raster or provide verified vector data to display overlays.</span>
            </div>

        </div>
    );
}

export default MapView;