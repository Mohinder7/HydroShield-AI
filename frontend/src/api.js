const API_URL =
    import.meta.env.VITE_API_URL ||
    "http://127.0.0.1:8000/api";


export async function checkBackendHealth() {
    const response = await fetch(`${API_URL}/health`);

    if (!response.ok) {
        throw new Error("Backend health check failed");
    }

    return response.json();
}


export async function getShelters() {
    const response = await fetch(`${API_URL}/shelters`);

    if (!response.ok) {
        throw new Error("Could not load shelters");
    }

    return response.json();
}


export async function getRasterInfo(file) {
    const formData = new FormData();

    formData.append("file", file);

    const response = await fetch(`${API_URL}/raster/info`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));

        throw new Error(
            error.detail || "Could not inspect raster"
        );
    }

    return response.json();
}


export async function preprocessSentinel1(file, pixelSpacingM = 10) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("pixel_spacing_m", pixelSpacingM);

    const response = await fetch(`${API_URL}/raster/preprocess`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
            error.detail || "Sentinel-1 preprocessing failed"
        );
    }

    const output = await response.blob();
    return new File(
        [output],
        "hydroshield_sentinel1_preprocessed.tif",
        { type: "image/tiff" }
    );
}


export async function detectFlood(
    file,
    band = 1,
    threshold = -17,
    valueScale = "dB"
) {
    const formData = new FormData();

    formData.append("file", file);
    formData.append("band", band);
    formData.append("threshold", threshold);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/flood/detect`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));

        throw new Error(
            error.detail || "Flood detection failed"
        );
    }

    return response.json();
}

export async function findSafeRoute({
    rasterFile,
    roadsFile,
    sheltersFile,
    latitude,
    longitude,
    band = 1,
    threshold = -17,
    valueScale = "dB",
}) {
    const formData = new FormData();

    formData.append("raster", rasterFile);
    formData.append("roads", roadsFile);
    formData.append("shelters", sheltersFile);
    formData.append("latitude", latitude);
    formData.append("longitude", longitude);
    formData.append("band", band);
    formData.append("threshold", threshold);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/routing/find`, {
        method: "POST",
        body: formData,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.detail || "Safe route calculation failed"
        );
    }

    return data;
}

export async function askAssistant(message, history = []) {
    const response = await fetch(`${API_URL}/assistant`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message,
            history,
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.detail ||
            "Could not connect to the AI assistant."
        );
    }

    return data;
}

export async function getBundledRaster() {
    const response = await fetch(`${API_URL}/datasets/raster`);
    if (!response.ok) {
        throw new Error("Could not load bundled raster");
    }
    const blob = await response.blob();
    return new File([blob], "peak_flood_subset.tif", { type: "image/tiff" });
}

export async function getBundledRoads() {
    const response = await fetch(`${API_URL}/datasets/roads`);
    if (!response.ok) {
        throw new Error("Could not load bundled roads");
    }
    const blob = await response.blob();
    return new File([blob], "patna_roads.geojson", { type: "application/json" });
}

export async function getBundledShelters() {
    const response = await fetch(`${API_URL}/datasets/shelters`);
    if (!response.ok) {
        throw new Error("Could not load bundled shelters");
    }
    const blob = await response.blob();
    return new File([blob], "patna_shelters.geojson", { type: "application/json" });
}

export async function runRFPretrained(file, band = 1, valueScale = "dB") {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("band", band);
    formData.append("value_scale", valueScale);
    const response = await fetch(`${API_URL}/flood/rf-pretrained`, {
        method: "POST",
        body: formData,
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "RF-pretrained flood detection failed");
    }
    return response.json();
}