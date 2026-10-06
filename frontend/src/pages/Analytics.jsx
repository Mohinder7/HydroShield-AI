import { useState } from "react";
import {
    detectFlood,
    detectFloodBundled,
    getRasterInfo,
    preprocessSentinel1,
    runRFPretrained,
    runRFPretrainedBundled,
} from "../api";
import Icon from "../components/Icon";

function Analytics() {
    // ── shared tab state ──────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState("threshold");

    // ── Threshold tab ─────────────────────────────────────────────────────
    const [file,         setFile]         = useState(null);
    const [threshold,    setThreshold]    = useState(-17);
    const [band,         setBand]         = useState(1);
    const [bandCount,    setBandCount]    = useState(1);
    const [bandNames,    setBandNames]    = useState([]);
    const [valueScale,   setValueScale]   = useState("dB");
    const [loading,      setLoading]      = useState(false);
    const [preprocessing,setPreprocessing]= useState(false);
    const [result,       setResult]       = useState(null);
    const [error,        setError]        = useState("");
    const [safeArchive,  setSafeArchive]  = useState(null);

    // bundled threshold run state
    const [bundledLoading, setBundledLoading] = useState(false);

    // ── RF tab ────────────────────────────────────────────────────────────
    const [rfFile,       setRfFile]       = useState(null);
    const [rfBand,       setRfBand]       = useState(1);
    const [rfValueScale, setRfValueScale] = useState("dB");
    const [rfLoading,    setRfLoading]    = useState(false);
    const [rfResult,     setRfResult]     = useState(null);
    const [rfError,      setRfError]      = useState("");

    // ── helpers ───────────────────────────────────────────────────────────
    const fmt    = (v, d = 2) =>
        v === undefined || v === null
            ? "—"
            : Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
    const fmtPct = (v) =>
        v === undefined || v === null ? "—" : `${Number(v).toFixed(2)}%`;

    // ══════════════════════════════════════════════════════════════════════
    //  THRESHOLD TAB HANDLERS
    // ══════════════════════════════════════════════════════════════════════

    /** Run bundled threshold analysis — no file upload needed */
    const handleAnalyzeBundled = async () => {
        setBundledLoading(true);
        setError("");
        setResult(null);
        try {
            const data = await detectFloodBundled(band, threshold, valueScale);
            setResult(data);
        } catch (err) {
            setError(err.message || "Bundled flood analysis failed.");
        } finally {
            setBundledLoading(false);
        }
    };

    /** Preprocess a zipped Sentinel-1 SAFE product */
    const handlePreprocess = async () => {
        if (!safeArchive) {
            setError("Select a zipped Sentinel-1 GRD SAFE product first.");
            return;
        }
        setPreprocessing(true);
        setResult(null);
        setError("");
        try {
            const output = await preprocessSentinel1(safeArchive);
            const info   = await getRasterInfo(output);
            setFile(output);
            setBand(1);
            setBandCount(info.bands);
            setBandNames(info.descriptions || []);
            setValueScale("dB");
        } catch (e) {
            setError(e.message || "Sentinel-1 preprocessing failed.");
        } finally {
            setPreprocessing(false);
        }
    };

    /** Handle custom GeoTIFF selection */
    const handleFileChange = async (event) => {
        const f = event.target.files?.[0] || null;
        setFile(f);
        setResult(null);
        setError("");
        setBand(1);
        setBandCount(1);
        setBandNames([]);
        if (!f) return;
        try {
            const info = await getRasterInfo(f);
            setBandCount(info.bands);
            setBandNames(info.descriptions || []);
        } catch (e) {
            setError(e.message || "Could not inspect raster.");
        }
    };

    /** Run threshold on user-uploaded custom GeoTIFF */
    const handleAnalyzeCustom = async () => {
        if (!file) {
            setError("Please select a GeoTIFF file first.");
            return;
        }
        setLoading(true);
        setError("");
        setResult(null);
        try {
            const data = await detectFlood(file, band, threshold, valueScale);
            setResult(data);
        } catch (err) {
            setError(err.message || "Flood analysis failed.");
        } finally {
            setLoading(false);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    //  RF TAB HANDLERS
    // ══════════════════════════════════════════════════════════════════════

    /** Run RF on bundled dataset — no upload */
    const handleRunRFBundled = async () => {
        setRfLoading(true);
        setRfError("");
        setRfResult(null);
        try {
            const data = await runRFPretrainedBundled(rfBand, rfValueScale);
            setRfResult(data);
        } catch (e) {
            setRfError(e.message || "RF analysis failed.");
        } finally {
            setRfLoading(false);
        }
    };

    /** Run RF on user-uploaded small GeoTIFF */
    const handleRunRFCustom = async () => {
        if (!rfFile) {
            setRfError("Please upload a GeoTIFF first.");
            return;
        }
        setRfLoading(true);
        setRfError("");
        setRfResult(null);
        try {
            const data = await runRFPretrained(rfFile, rfBand, rfValueScale);
            setRfResult(data);
        } catch (e) {
            setRfError(e.message || "RF analysis failed.");
        } finally {
            setRfLoading(false);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    //  RENDER
    // ══════════════════════════════════════════════════════════════════════
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

            {/* ── Tab switcher ─────────────────────────────────────────── */}
            <div className="analytics-tabs">
                <button
                    className={`analytics-tab${activeTab === "threshold" ? " active" : ""}`}
                    onClick={() => setActiveTab("threshold")}
                >
                    <Icon name="chart" size={16} /> Threshold Detection
                </button>
                <button
                    className={`analytics-tab${activeTab === "rf" ? " active" : ""}`}
                    onClick={() => setActiveTab("rf")}
                >
                    <Icon name="layers" size={16} /> Random Forest (Pretrained)
                </button>
            </div>

            {/* ════════════════════════════════════════════════════════════
                THRESHOLD TAB
            ════════════════════════════════════════════════════════════ */}
            {activeTab === "threshold" && (
                <>
                    <div className="analytics-grid">

                        {/* ── Bundled analysis (primary) ───────────────── */}
                        <div className="analytics-card analysis-controls">
                            <div className="card-title">
                                <div>
                                    <h2>Bundled SAR Analysis</h2>
                                    <p>
                                        Run flood detection on the Patna Sentinel-1
                                        dataset — no file upload needed.
                                    </p>
                                </div>
                            </div>

                            <div className="bundled-info-box">
                                <Icon name="layers" size={18} />
                                <div>
                                    <strong>Patna SAR Dataset (1.4 GB)</strong>
                                    <span>
                                        Sentinel-1 IW GRD · Oct 2019 ·
                                        Analysed directly on the server
                                    </span>
                                </div>
                            </div>

                            {/* Band / scale / threshold controls */}
                            <div className="control-row">
                                <div className="form-group">
                                    <label>Value Scale</label>
                                    <select
                                        value={valueScale}
                                        onChange={(e) => setValueScale(e.target.value)}
                                    >
                                        <option value="dB">dB</option>
                                        <option value="Linear power">Linear power</option>
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
                                    <span>−30 dB (very wet)</span>
                                    <span>−5 dB (dry)</span>
                                </div>
                            </div>

                            <button
                                className="primary-action"
                                onClick={handleAnalyzeBundled}
                                disabled={bundledLoading}
                            >
                                {bundledLoading
                                    ? "Analysing Patna SAR…"
                                    : "▶ Run Flood Analysis (Bundled)"}
                            </button>

                            {error && (
                                <div className="analytics-error">{error}</div>
                            )}

                            {/* Divider */}
                            <div className="section-divider">
                                <span>or upload your own small GeoTIFF</span>
                            </div>

                            {/* Custom upload (for small rasters only) */}
                            <details className="custom-upload-details">
                                <summary>Upload a custom GeoTIFF</summary>

                                <div className="form-group preprocessing-control" style={{marginTop:"12px"}}>
                                    <label htmlFor="sentinel-safe-product">
                                        Preprocess a Sentinel-1 GRD SAFE product
                                    </label>
                                    <input
                                        id="sentinel-safe-product"
                                        type="file"
                                        accept=".zip"
                                        onChange={(e) => {
                                            setSafeArchive(
                                                e.target.files?.[0] || null
                                            );
                                            setFile(null);
                                            setBandCount(1);
                                            setBandNames([]);
                                            setResult(null);
                                            setError("");
                                        }}
                                    />
                                    <small>
                                        SNAP GPT applies orbit correction,
                                        calibration, and terrain correction.
                                    </small>
                                    <button
                                        type="button"
                                        className="primary-action"
                                        onClick={handlePreprocess}
                                        disabled={preprocessing || !safeArchive}
                                    >
                                        {preprocessing
                                            ? "Preprocessing…"
                                            : "Preprocess with SNAP"}
                                    </button>
                                </div>

                                <div className="form-group">
                                    <label>Preprocessed backscatter GeoTIFF</label>
                                    <input
                                        type="file"
                                        accept=".tif,.tiff"
                                        onChange={handleFileChange}
                                    />
                                    {file && (
                                        <div className="selected-file">
                                            <span>Selected</span>
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
                                            {Array.from(
                                                { length: bandCount },
                                                (_, i) => (
                                                    <option
                                                        key={i + 1}
                                                        value={i + 1}
                                                    >
                                                        {bandNames[i] &&
                                                        bandNames[i] !==
                                                            `Band ${i + 1}`
                                                            ? `Band ${i + 1} · ${bandNames[i]}`
                                                            : `Band ${i + 1}`}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </div>
                                </div>

                                <button
                                    className="primary-action"
                                    onClick={handleAnalyzeCustom}
                                    disabled={loading || !file}
                                >
                                    {loading
                                        ? "Analysing…"
                                        : "Run Flood Analysis (Custom)"}
                                </button>
                            </details>
                        </div>

                        {/* ── Method info card ─────────────────────────── */}
                        <div className="analytics-card method-card">
                            <div className="card-title">
                                <div>
                                    <h2>Detection Method</h2>
                                    <p>SAR threshold-based approach</p>
                                </div>
                            </div>
                            <div className="method-item">
                                <span>Algorithm</span>
                                <strong>SAR Backscatter Threshold</strong>
                            </div>
                            <div className="method-item">
                                <span>Satellite</span>
                                <strong>Sentinel-1 IW GRD</strong>
                            </div>
                            <div className="method-item">
                                <span>Scene</span>
                                <strong>Patna, Bihar · Oct 2019</strong>
                            </div>
                            <div className="method-item">
                                <span>Threshold</span>
                                <strong>{threshold} dB</strong>
                            </div>
                            <div className="method-item">
                                <span>Scale</span>
                                <strong>{valueScale}</strong>
                            </div>
                            <div className="method-item">
                                <span>Processing</span>
                                <strong>Server-side (no upload)</strong>
                            </div>
                        </div>
                    </div>

                    {/* ── Threshold results ─────────────────────────────── */}
                    {result && (
                        <>
                            <div className="analytics-section-heading">
                                <div>
                                    <h2>Analysis Results</h2>
                                    <p>
                                        Flood detection results for Patna SAR
                                        scene.
                                    </p>
                                </div>
                            </div>

                            <div className="analytics-stat-grid">
                                <div className="analytics-stat-card">
                                    <span>Flooded Area</span>
                                    <strong>
                                        {fmt(result.flooded_area_km2)}
                                    </strong>
                                    <small>km²</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Flood Percentage</span>
                                    <strong>
                                        {fmt(result.flooded_percentage)}
                                    </strong>
                                    <small>% of valid area</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Risk Level</span>
                                    <strong className="risk-value">
                                        {result.risk?.level || "Unavailable"}
                                    </strong>
                                    <small>Area-share category</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Flooded Pixels</span>
                                    <strong>
                                        {fmt(result.flooded_pixels, 0)}
                                    </strong>
                                    <small>Detected pixels</small>
                                </div>
                            </div>

                            {result.area_error && (
                                <div className="analytics-error">
                                    Area unavailable: {result.area_error}
                                </div>
                            )}

                            <div className="analytics-card distribution-card">
                                <div className="card-title">
                                    <div>
                                        <h2>Flood Distribution</h2>
                                        <p>
                                            Flooded vs non-flooded valid pixels.
                                        </p>
                                    </div>
                                </div>
                                <div className="distribution-bars">
                                    <div className="distribution-row">
                                        <div className="distribution-label">
                                            <span>Flooded</span>
                                            <strong>
                                                {fmt(result.flooded_pixels, 0)}
                                            </strong>
                                        </div>
                                        <div className="distribution-track">
                                            <div
                                                className="distribution-fill flooded"
                                                style={{
                                                    width: `${Math.min(
                                                        100,
                                                        Number(
                                                            result.flooded_percentage ||
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
                                                {fmt(
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
                                                                result.flooded_percentage ||
                                                                    0
                                                            )
                                                    )}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="analytics-card">
                                <div className="card-title">
                                    <div>
                                        <h2>Raster Details</h2>
                                        <p>Technical metadata</p>
                                    </div>
                                </div>
                                <div className="details-grid">
                                    <div>
                                        <span>Total Pixels</span>
                                        <strong>
                                            {fmt(result.total_pixels, 0)}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Valid Pixels</span>
                                        <strong>
                                            {fmt(result.valid_pixels, 0)}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Threshold</span>
                                        <strong>
                                            {result.threshold_db ?? threshold}{" "}
                                            dB
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Source</span>
                                        <strong>
                                            {result.source === "bundled"
                                                ? "Bundled Patna SAR"
                                                : "Custom upload"}
                                        </strong>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {!result && !loading && !bundledLoading && (
                        <div className="analytics-empty">
                            <div className="empty-icon">
                                <Icon name="chart" size={25} />
                            </div>
                            <h2>Ready to analyse</h2>
                            <p>
                                Click{" "}
                                <strong>Run Flood Analysis (Bundled)</strong>{" "}
                                above to analyse the Patna SAR dataset instantly
                                — no file upload needed.
                            </p>
                        </div>
                    )}
                </>
            )}

            {/* ════════════════════════════════════════════════════════════
                RF TAB
            ════════════════════════════════════════════════════════════ */}
            {activeTab === "rf" && (
                <>
                    <div className="analytics-grid">

                        {/* ── RF controls ──────────────────────────────── */}
                        <div className="analytics-card analysis-controls">
                            <div className="card-title">
                                <div>
                                    <h2>Random Forest (Pretrained)</h2>
                                    <p>
                                        No labelled data needed. Otsu
                                        thresholding auto-generates
                                        pseudo-labels, then a 200-tree RF
                                        classifier trains on 6 texture
                                        features.
                                    </p>
                                </div>
                            </div>

                            <div className="bundled-info-box">
                                <Icon name="layers" size={18} />
                                <div>
                                    <strong>Patna SAR Dataset (Bundled)</strong>
                                    <span>
                                        6 features: raw dB · local mean ·
                                        local std · gradient · contrast ·
                                        homogeneity
                                    </span>
                                </div>
                            </div>

                            <div className="control-row">
                                <div className="form-group">
                                    <label>Value Scale</label>
                                    <select
                                        value={rfValueScale}
                                        onChange={(e) =>
                                            setRfValueScale(e.target.value)
                                        }
                                    >
                                        <option value="dB">dB</option>
                                        <option value="Linear power">
                                            Linear power
                                        </option>
                                    </select>
                                </div>
                            </div>

                            <button
                                className="primary-action"
                                onClick={handleRunRFBundled}
                                disabled={rfLoading}
                            >
                                {rfLoading
                                    ? "Training & Classifying…"
                                    : "▶ Run Random Forest (Bundled)"}
                            </button>

                            {rfError && (
                                <div className="analytics-error">{rfError}</div>
                            )}

                            <div className="section-divider">
                                <span>or upload a small custom GeoTIFF</span>
                            </div>

                            <details className="custom-upload-details">
                                <summary>Upload a custom GeoTIFF</summary>
                                <div className="form-group" style={{marginTop:"12px"}}>
                                    <label>
                                        GeoTIFF (small files only —
                                        avoid files &gt; 200 MB)
                                    </label>
                                    <input
                                        type="file"
                                        accept=".tif,.tiff"
                                        onChange={(e) => {
                                            setRfFile(
                                                e.target.files?.[0] || null
                                            );
                                            setRfResult(null);
                                            setRfError("");
                                        }}
                                    />
                                    {rfFile && (
                                        <div className="selected-file">
                                            <span>Selected</span>
                                            <strong>{rfFile.name}</strong>
                                        </div>
                                    )}
                                </div>
                                <div className="control-row">
                                    <div className="form-group">
                                        <label>Band</label>
                                        <select
                                            value={rfBand}
                                            onChange={(e) =>
                                                setRfBand(
                                                    Number(e.target.value)
                                                )
                                            }
                                        >
                                            <option value={1}>Band 1</option>
                                            <option value={2}>Band 2</option>
                                        </select>
                                    </div>
                                </div>
                                <button
                                    className="primary-action"
                                    onClick={handleRunRFCustom}
                                    disabled={rfLoading || !rfFile}
                                >
                                    {rfLoading
                                        ? "Analysing…"
                                        : "Run RF (Custom Upload)"}
                                </button>
                            </details>
                        </div>

                        {/* ── RF method card ───────────────────────────── */}
                        <div className="analytics-card method-card">
                            <div className="card-title">
                                <div>
                                    <h2>RF Method</h2>
                                    <p>
                                        Unsupervised bootstrapped
                                        classification
                                    </p>
                                </div>
                            </div>
                            <div className="method-item">
                                <span>Algorithm</span>
                                <strong>Random Forest Classifier</strong>
                            </div>
                            <div className="method-item">
                                <span>Label Generation</span>
                                <strong>Otsu Thresholding (auto)</strong>
                            </div>
                            <div className="method-item">
                                <span>Features</span>
                                <strong>6 texture + spatial</strong>
                            </div>
                            <div className="method-item">
                                <span>Estimators</span>
                                <strong>200 trees</strong>
                            </div>
                            <div className="method-item">
                                <span>Training cap</span>
                                <strong>200 k pixels (stratified)</strong>
                            </div>
                            <div className="method-item">
                                <span>Validation</span>
                                <strong>20% stratified holdout</strong>
                            </div>
                            <div className="method-item">
                                <span>Processing</span>
                                <strong>Server-side (no upload)</strong>
                            </div>
                        </div>
                    </div>

                    {/* ── RF results ────────────────────────────────────── */}
                    {rfResult && (
                        <>
                            <div className="analytics-section-heading">
                                <div>
                                    <h2>RF Analysis Results</h2>
                                    <p>
                                        Random Forest classification with
                                        Otsu pseudo-labels and 6 texture
                                        features.
                                    </p>
                                </div>
                            </div>

                            <div className="analytics-stat-grid">
                                <div className="analytics-stat-card">
                                    <span>Flooded Area</span>
                                    <strong>
                                        {fmt(rfResult.flooded_area_km2)}
                                    </strong>
                                    <small>km²</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Flood Percentage</span>
                                    <strong>
                                        {fmt(rfResult.flooded_percentage)}
                                    </strong>
                                    <small>% of valid area</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Risk Level</span>
                                    <strong className="risk-value">
                                        {rfResult.risk?.level || "Unavailable"}
                                    </strong>
                                    <small>RF classification</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Auto Threshold</span>
                                    <strong>
                                        {fmt(rfResult.otsu_threshold_db)} dB
                                    </strong>
                                    <small>Otsu auto-detected</small>
                                </div>
                            </div>

                            {/* Model metrics */}
                            <div className="analytics-card">
                                <div className="card-title">
                                    <div>
                                        <h2>Model Metrics</h2>
                                        <p>
                                            20% stratified holdout evaluation
                                        </p>
                                    </div>
                                </div>
                                <div className="details-grid">
                                    <div>
                                        <span>Accuracy</span>
                                        <strong>
                                            {fmtPct(
                                                rfResult.metrics?.accuracy *
                                                    100
                                            )}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Precision</span>
                                        <strong>
                                            {fmtPct(
                                                rfResult.metrics?.precision *
                                                    100
                                            )}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Recall</span>
                                        <strong>
                                            {fmtPct(
                                                rfResult.metrics?.recall * 100
                                            )}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>F1 Score</span>
                                        <strong>
                                            {fmtPct(
                                                rfResult.metrics?.f1 * 100
                                            )}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>IoU</span>
                                        <strong>
                                            {fmtPct(
                                                rfResult.metrics?.iou * 100
                                            )}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Train / Test Pixels</span>
                                        <strong>
                                            {fmt(
                                                rfResult.metrics?.train_pixels,
                                                0
                                            )}{" "}
                                            /{" "}
                                            {fmt(
                                                rfResult.metrics?.test_pixels,
                                                0
                                            )}
                                        </strong>
                                    </div>
                                </div>
                            </div>

                            {/* Feature importances */}
                            {rfResult.feature_importances && (
                                <div className="analytics-card">
                                    <div className="card-title">
                                        <div>
                                            <h2>Feature Importances</h2>
                                            <p>
                                                Which features the RF relied on
                                                most
                                            </p>
                                        </div>
                                    </div>
                                    <div className="distribution-bars">
                                        {Object.entries(
                                            rfResult.feature_importances
                                        )
                                            .sort((a, b) => b[1] - a[1])
                                            .map(([name, imp]) => (
                                                <div
                                                    key={name}
                                                    className="distribution-row"
                                                >
                                                    <div className="distribution-label">
                                                        <span>{name}</span>
                                                        <strong>
                                                            {(imp * 100).toFixed(
                                                                1
                                                            )}
                                                            %
                                                        </strong>
                                                    </div>
                                                    <div className="distribution-track">
                                                        <div
                                                            className="distribution-fill"
                                                            style={{
                                                                width: `${(
                                                                    imp * 100
                                                                ).toFixed(1)}%`,
                                                                backgroundColor:
                                                                    "#6366f1",
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}

                            {rfResult.area_error && (
                                <div className="analytics-error">
                                    Area unavailable: {rfResult.area_error}
                                </div>
                            )}
                        </>
                    )}

                    {!rfResult && !rfLoading && (
                        <div className="analytics-empty">
                            <div className="empty-icon">
                                <Icon name="layers" size={25} />
                            </div>
                            <h2>Ready for RF analysis</h2>
                            <p>
                                Click{" "}
                                <strong>Run Random Forest (Bundled)</strong>{" "}
                                to train and classify the Patna SAR
                                dataset — no upload needed.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default Analytics;
