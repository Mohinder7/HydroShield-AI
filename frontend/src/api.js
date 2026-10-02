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