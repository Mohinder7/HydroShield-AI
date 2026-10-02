import { useState } from "react";
import { detectFlood } from "../api";

function Analytics() {
    const [file, setFile] = useState(null);
    const [threshold, setThreshold] = useState(-17);
    const [band, setBand] = useState(1);
    const [valueScale, setValueScale] = useState("dB");

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");

    const handleAnalyze = async () => {
        if (!file) {
            setError("Please select a Sentinel-1 GeoTIFF file first.");
            return;
        }

        setLoading(true);
        setError("");
        setResult(null);

        try {
            const data = await detectFlood(
                file,
                band,
                threshold,
                valueScale
            );

            setResult(data);
        } catch (err) {
            setError(err.message || "Flood analysis failed.");
        } finally {
            setLoading(false);
        }
    };

    const formatNumber = (value, digits = 2) => {
        if (value === undefined || value === null) {
            return "—";
        }

        return Number(value).toLocaleString(undefined, {
            maximumFractionDigits: digits,
        });
    };

    return (
        <div className="analytics-page">

            <div className="page-heading">
                <div>
                    <h1>Flood Analytics</h1>
                    <p>
                        Analyze Sentinel-1 SAR imagery and evaluate
                        flood extent and risk.
                    </p>
                </div>
            </div>

            <div className="analytics-grid">

                {/* Analysis Controls */}
                <div className="analytics-card analysis-controls">

                    <div className="card-title">
                        <div>
                            <h2>Run Flood Analysis</h2>
                            <p>
                                Upload a Sentinel-1 GeoTIFF raster
                                for flood detection.
                            </p>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Sentinel-1 GeoTIFF</label>

                        <input
                            type="file"
                            accept=".tif,.tiff"
                            onChange={(e) => {
                                setFile(e.target.files?.[0] || null);
                                setResult(null);
                                setError("");
                            }}
                        />

                        {file && (
                            <div className="selected-file">
                                <span>Selected file</span>
                                <strong>{file.name}</strong>
                            </div>
                        )}
                    </div>

                    <div className="control-row">

                        <div className="form-group">
                            <label>SAR Band</label>

                            <select
                                value={band}
                                onChange={(e) =>
                                    setBand(Number(e.target.value))
                                }
                            >
                                <option value={1}>Band 1</option>
                                <option value={2}>Band 2</option>
                                <option value={3}>Band 3</option>
                                <option value={4}>Band 4</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Value Scale</label>

                            <select
                                value={valueScale}
                                onChange={(e) =>
                                    setValueScale(e.target.value)
                                }
                            >
                                <option value="dB">dB</option>
                                <option value="linear">Linear</option>
                            </select>
                        </div>

                    </div>

                    <div className="form-group">
                        <div className="label-row">
                            <label>Flood Threshold</label>
                            <span>{threshold} dB</span>
                        </div>

                        <input
                            type="range"
                            min="-30"
                            max="-5"
                            step="0.5"
                            value={threshold}
                            onChange={(e) =>
                                setThreshold(Number(e.target.value))
                            }
                        />

                        <div className="range-labels">
                            <span>-30 dB</span>
                            <span>-5 dB</span>
                        </div>
                    </div>

                    <button
                        className="primary-action"
                        onClick={handleAnalyze}
                        disabled={loading || !file}
                    >
                        {loading
                            ? "Analyzing..."
                            : "Run Flood Analysis"}
                    </button>

                    {error && (
                        <div className="analytics-error">
                            {error}
                        </div>
                    )}

                </div>


                {/* Method Information */}
                <div className="analytics-card method-card">

                    <div className="card-title">
                        <div>
                            <h2>Detection Method</h2>
                            <p>Current analysis configuration</p>
                        </div>
                    </div>

                    <div className="method-item">
                        <span>Algorithm</span>
                        <strong>Threshold-based SAR Detection</strong>
                    </div>

                    <div className="method-item">
                        <span>Satellite Data</span>
                        <strong>Sentinel-1 SAR</strong>
                    </div>

                    <div className="method-item">
                        <span>Input Format</span>
                        <strong>GeoTIFF</strong>
                    </div>

                    <div className="method-item">
                        <span>Selected Band</span>
                        <strong>Band {band}</strong>
                    </div>

                    <div className="method-item">
                        <span>Threshold</span>
                        <strong>{threshold} dB</strong>
                    </div>

                </div>

            </div>


            {/* Results */}
            {result && (
                <>
                    <div className="analytics-section-heading">
                        <div>
                            <h2>Analysis Results</h2>
                            <p>
                                Results generated by the HydroShield
                                AI flood-analysis backend.
                            </p>
                        </div>
                    </div>

                    <div className="analytics-stat-grid">

                        <div className="analytics-stat-card">
                            <span>Flooded Area</span>
                            <strong>
                                {formatNumber(result.flooded_area_km2)}
                            </strong>
                            <small>km²</small>
                        </div>

                        <div className="analytics-stat-card">
                            <span>Flood Percentage</span>
                            <strong>
                                {formatNumber(result.flood_share_percent)}
                            </strong>
                            <small>% of valid area</small>
                        </div>

                        <div className="analytics-stat-card">
                            <span>Risk Level</span>
                            <strong className="risk-value">
                                {result.risk_level || "—"}
                            </strong>
                            <small>Current assessment</small>
                        </div>

                        <div className="analytics-stat-card">
                            <span>Flooded Pixels</span>
                            <strong>
                                {formatNumber(
                                    result.flooded_pixels,
                                    0
                                )}
                            </strong>
                            <small>Detected pixels</small>
                        </div>

                    </div>


                    {/* Pixel Distribution */}
                    <div className="analytics-card distribution-card">

                        <div className="card-title">
                            <div>
                                <h2>Flood Distribution</h2>
                                <p>
                                    Distribution of detected and
                                    non-flooded valid pixels.
                                </p>
                            </div>
                        </div>

                        <div className="distribution-bars">

                            <div className="distribution-row">

                                <div className="distribution-label">
                                    <span>Flooded</span>
                                    <strong>
                                        {formatNumber(
                                            result.flooded_pixels,
                                            0
                                        )}
                                    </strong>
                                </div>

                                <div className="distribution-track">
                                    <div
                                        className="distribution-fill flooded"
                                        style={{
                                            width: `${Math.min(
                                                100,
                                                Number(
                                                    result.flood_share_percent ||
                                                        0
                                                )
                                            )}%`,
                                        }}
                                    />
                                </div>

                            </div>


                            <div className="distribution-row">

                                <div className="distribution-label">
                                    <span>Non-flooded</span>
                                    <strong>
                                        {formatNumber(
                                            Math.max(
                                                0,
                                                Number(
                                                    result.valid_pixels ||
                                                        0
                                                ) -
                                                    Number(
                                                        result.flooded_pixels ||
                                                            0
                                                    )
                                            ),
                                            0
                                        )}
                                    </strong>
                                </div>

                                <div className="distribution-track">
                                    <div
                                        className="distribution-fill safe"
                                        style={{
                                            width: `${Math.max(
                                                0,
                                                100 -
                                                    Number(
                                                        result.flood_share_percent ||
                                                            0
                                                    )
                                            )}%`,
                                        }}
                                    />
                                </div>

                            </div>

                        </div>

                    </div>


                    {/* Raster Information */}
                    <div className="analytics-card">

                        <div className="card-title">
                            <div>
                                <h2>Raster Analysis Details</h2>
                                <p>
                                    Technical information returned
                                    by the backend.
                                </p>
                            </div>
                        </div>

                        <div className="details-grid">

                            <div>
                                <span>Total Pixels</span>
                                <strong>
                                    {formatNumber(
                                        result.total_pixels,
                                        0
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Valid Pixels</span>
                                <strong>
                                    {formatNumber(
                                        result.valid_pixels,
                                        0
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Threshold</span>
                                <strong>
                                    {result.threshold ?? threshold} dB
                                </strong>
                            </div>

                            <div>
                                <span>Value Scale</span>
                                <strong>
                                    {result.value_scale || valueScale}
                                </strong>
                            </div>

                        </div>

                    </div>
                </>
            )}

            {!result && !loading && (
                <div className="analytics-empty">

                    <div className="empty-icon">
                        📊
                    </div>

                    <h2>No analysis available</h2>

                    <p>
                        Upload a Sentinel-1 GeoTIFF above and run
                        flood analysis to generate analytics.
                    </p>

                </div>
            )}

        </div>
    );
}

export default Analytics;