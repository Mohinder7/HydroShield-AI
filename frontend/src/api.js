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

// ─── Bundled dataset file downloads (only use for small files) ───────────────

export async function getBundledRoads() {
    const response = await fetch(`${API_URL}/datasets/roads`);
    if (!response.ok) throw new Error("Could not load bundled roads");
    const blob = await response.blob();
    return new File([blob], "patna_roads.geojson", { type: "application/json" });
}

export async function getBundledShelters() {
    const response = await fetch(`${API_URL}/datasets/shelters`);
    if (!response.ok) throw new Error("Could not load bundled shelters");
    const blob = await response.blob();
    return new File([blob], "patna_shelters.geojson", { type: "application/json" });
}

// NOTE: getBundledRaster() intentionally removed — the SAR file is 1.4 GB and
// cannot be transferred through the browser. Use the server-side bundled
// endpoints below instead (they read from disk directly).

// ─── Server-side bundled analysis (no file upload) ───────────────────────────

/**
 * Run threshold flood detection on the bundled SAR raster (server reads from disk).
 * No file upload — works regardless of raster file size.
 */
export async function detectFloodBundled(
    band = 1,
    threshold = -17,
    valueScale = "dB"
) {
    const formData = new FormData();
    formData.append("band", band);
    formData.append("threshold", threshold);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/flood/detect-bundled`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Bundled flood detection failed");
    return data;
}

/**
 * Run multi-feature Random Forest on the bundled SAR raster (server reads from disk).
 * No file upload — works regardless of raster file size.
 */
export async function runRFPretrainedBundled(band = 1, valueScale = "dB") {
    const formData = new FormData();
    formData.append("band", band);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/flood/rf-pretrained-bundled`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Bundled RF detection failed");
    return data;
}

/**
 * Find safe route using bundled datasets (server reads from disk).
 * Only needs latitude and longitude — no file uploads.
 */
export async function findSafeRouteBundled({
    latitude,
    longitude,
    band = 1,
    threshold = -17,
    valueScale = "dB",
}) {
    const formData = new FormData();
    formData.append("latitude", latitude);
    formData.append("longitude", longitude);
    formData.append("band", band);
    formData.append("threshold", threshold);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/routing/find-bundled`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Bundled routing failed");
    return data;
}

/**
 * Run RF with a user-uploaded file (only for small custom rasters).
 * For the bundled 1.4 GB dataset use runRFPretrainedBundled() instead.
 */
export async function runRFPretrained(file, band = 1, valueScale = "dB") {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("band", band);
    formData.append("value_scale", valueScale);
    const response = await fetch(`${API_URL}/flood/rf-pretrained`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "RF-pretrained flood detection failed");
    return data;
}

/**
 * Run flood detection using the BUNDLED PRETRAINED weights (no training, no upload).
 * Loads random_forest_model.joblib + scaler.joblib from weights/ on the server.
 */
export async function detectFloodPretrainedBundled(band = 1, valueScale = "dB") {
    const formData = new FormData();
    formData.append("band", band);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/flood/detect-pretrained-bundled`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Pretrained RF bundled detection failed");
    return data;
}

/**
 * Run flood detection using the PRETRAINED weights on a user-uploaded raster.
 * Loads random_forest_model.joblib + scaler.joblib from weights/ on the server.
 */
export async function detectFloodPretrained(file, band = 1, valueScale = "dB") {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("band", band);
    formData.append("value_scale", valueScale);

    const response = await fetch(`${API_URL}/flood/detect-pretrained`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Pretrained RF detection failed");
    return data;
}

// ─── GEE pretrained RF model ─────────────────────────────────────────────────

/**
 * GET /api/model/status
 * Returns model readiness, feature names, raster availability, and diagnostics.
 */
export async function getModelStatus() {
    const response = await fetch(`${API_URL}/model/status`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Could not fetch model status");
    return data;
}

/**
 * POST /api/flood/predict
 * Run the GEE-based pretrained RF over the configured feature raster.
 * Returns candidate_pixels, candidate_percentage, raster metadata, output_filename.
 *
 * @param {string|null} outputFilename  Optional output stem (letters/digits/-_ only).
 */
export async function runGeeRFPredict(outputFilename = null) {
    const body = {};
    if (outputFilename) body.output_filename = outputFilename;

    const response = await fetch(`${API_URL}/flood/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "GEE RF prediction failed");
    return data;
}
