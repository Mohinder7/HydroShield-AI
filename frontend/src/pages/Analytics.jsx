import { useState } from "react";
import {
    detectFlood,
    detectFloodBundled,
    getModelStatus,
    getRasterInfo,
    preprocessSentinel1,
    runGeeRFPredict,
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

    // ── GEE RF tab ────────────────────────────────────────────────────────
    const [geeStatus,    setGeeStatus]    = useState(null);
    const [geeStatusErr, setGeeStatusErr] = useState("");
    const [geeLoading,   setGeeLoading]   = useState(false);
    const [geeResult,    setGeeResult]    = useState(null);
    const [geeError,     setGeeError]     = useState("");

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
    //  GEE RF TAB HANDLERS
    // ══════════════════════════════════════════════════════════════════════

    const handleCheckGeeStatus = async () => {
        setGeeStatusErr("");
        setGeeStatus(null);
        try {
            const data = await getModelStatus();
            setGeeStatus(data);
        } catch (e) {
            setGeeStatusErr(e.message || "Could not fetch model status.");
        }
    };

    const handleRunGeePredict = async () => {
        setGeeLoading(true);
        setGeeError("");
        setGeeResult(null);
        try {
            const data = await runGeeRFPredict();
            setGeeResult(data);
        } catch (e) {
            setGeeError(e.message || "GEE RF prediction failed.");
        } finally {
            setGeeLoading(false);
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
                <button
                    className={`analytics-tab${activeTab === "gee" ? " active" : ""}`}
                    onClick={() => { setActiveTab("gee"); if (!geeStatus) handleCheckGeeStatus(); }}
                >
                    <Icon name="cpu" size={16} /> GEE RF Flood Candidates
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

            {/* ════════════════════════════════════════════════════════════
                GEE RF FLOOD CANDIDATES TAB
            ════════════════════════════════════════════════════════════ */}
            {activeTab === "gee" && (
                <>
                    <div className="analytics-grid">

                        {/* ── Controls card ────────────────────────────── */}
                        <div className="analytics-card analysis-controls">
                            <div className="card-title">
                                <div>
                                    <h2>GEE RF Flood-Candidate Prediction</h2>
                                    <p>
                                        Uses a Random Forest trained on six
                                        Sentinel-1 change-detection features
                                        exported from Google Earth Engine.
                                        No upload needed — runs on the
                                        configured server-side feature raster.
                                    </p>
                                </div>
                            </div>

                            {/* Model status */}
                            <div className="bundled-info-box">
                                <Icon name="cpu" size={18} />
                                <div>
                                    <strong>Pretrained GEE Random Forest</strong>
                                    <span>
                                        Features: beforeVV · afterVV · beforeVH
                                        · afterVH · vvChange · vhChange
                                    </span>
                                </div>
                            </div>

                            <button
                                className="primary-action"
                                style={{ marginBottom: 8 }}
                                onClick={handleCheckGeeStatus}
                                disabled={geeLoading}
                            >
                                ↻ Check Model Status
                            </button>

                            {geeStatusErr && (
                                <div className="analytics-error">{geeStatusErr}</div>
                            )}

                            {geeStatus && (
                                <div
                                    className="analytics-card"
                                    style={{ margin: "8px 0", padding: "12px 16px" }}
                                >
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                                        <span
                                            style={{
                                                padding: "2px 10px",
                                                borderRadius: 12,
                                                fontSize: "0.78rem",
                                                fontWeight: 600,
                                                background: geeStatus.model_ready ? "#dcfce7" : "#fee2e2",
                                                color: geeStatus.model_ready ? "#166534" : "#991b1b",
                                            }}
                                        >
                                            {geeStatus.model_ready ? "✓ Model ready" : "✗ Model not ready"}
                                        </span>
                                        <span
                                            style={{
                                                padding: "2px 10px",
                                                borderRadius: 12,
                                                fontSize: "0.78rem",
                                                fontWeight: 600,
                                                background: geeStatus.feature_raster_found ? "#dcfce7" : "#fef9c3",
                                                color: geeStatus.feature_raster_found ? "#166534" : "#854d0e",
                                            }}
                                        >
                                            {geeStatus.feature_raster_found
                                                ? "✓ Feature raster found"
                                                : "⚠ Feature raster missing"}
                                        </span>
                                    </div>
                                    <div className="details-grid" style={{ fontSize: "0.82rem" }}>
                                        <div>
                                            <span>Version</span>
                                            <strong>{geeStatus.model_version}</strong>
                                        </div>
                                        <div>
                                            <span>Trees</span>
                                            <strong>{geeStatus.n_estimators ?? "—"}</strong>
                                        </div>
                                        <div>
                                            <span>Features</span>
                                            <strong>{geeStatus.feature_names?.join(", ")}</strong>
                                        </div>
                                        {geeStatus.model_error && (
                                            <div style={{ gridColumn: "1/-1" }}>
                                                <span>Error</span>
                                                <strong style={{ color: "#dc2626", wordBreak: "break-all" }}>
                                                    {geeStatus.model_error}
                                                </strong>
                                            </div>
                                        )}
                                        {!geeStatus.feature_raster_found && (
                                            <div style={{ gridColumn: "1/-1" }}>
                                                <span>Fix</span>
                                                <strong style={{ color: "#92400e" }}>
                                                    Place patna_s1_features_aug2026.tif in
                                                    EPICS--main/datasets/ or set
                                                    HYDROSHIELD_FEATURE_RASTER in .env
                                                </strong>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <button
                                className="primary-action"
                                onClick={handleRunGeePredict}
                                disabled={geeLoading}
                                style={{ marginTop: 8 }}
                            >
                                {geeLoading
                                    ? "Running inference…"
                                    : "▶ Run GEE RF Prediction"}
                            </button>

                            {geeError && (
                                <div className="analytics-error" style={{ marginTop: 8 }}>
                                    {geeError}
                                </div>
                            )}
                        </div>

                        {/* ── Method card ───────────────────────────────── */}
                        <div className="analytics-card method-card">
                            <div className="card-title">
                                <div>
                                    <h2>GEE RF Method</h2>
                                    <p>Change-detection feature classification</p>
                                </div>
                            </div>
                            <div className="method-item">
                                <span>Algorithm</span>
                                <strong>Random Forest (100 trees)</strong>
                            </div>
                            <div className="method-item">
                                <span>Features</span>
                                <strong>6 GEE change-detection bands</strong>
                            </div>
                            <div className="method-item">
                                <span>Scaler</span>
                                <strong>StandardScaler (pre-fitted)</strong>
                            </div>
                            <div className="method-item">
                                <span>Training</span>
                                <strong>Sentinel-1 Aug 2026 (Patna)</strong>
                            </div>
                            <div className="method-item">
                                <span>Labels</span>
                                <strong>Threshold-generated candidates</strong>
                            </div>
                            <div className="method-item">
                                <span>Output</span>
                                <strong>Georeferenced uint8 GeoTIFF</strong>
                            </div>
                            <div
                                className="analytics-error"
                                style={{
                                    marginTop: 12,
                                    fontSize: "0.78rem",
                                    background: "#fef9c3",
                                    color: "#92400e",
                                    border: "1px solid #fde68a",
                                }}
                            >
                                ⚠ Outputs are flood CANDIDATES from SAR
                                change detection — not confirmed flooding.
                                Do not use as operational flood extent.
                            </div>
                        </div>
                    </div>

                    {/* ── GEE results ───────────────────────────────────── */}
                    {geeResult && (
                        <>
                            <div className="analytics-section-heading">
                                <div>
                                    <h2>GEE RF Prediction Results</h2>
                                    <p>
                                        Flood-candidate classification using
                                        pretrained GEE Random Forest.
                                    </p>
                                </div>
                            </div>

                            <div className="analytics-stat-grid">
                                <div className="analytics-stat-card">
                                    <span>Candidate Pixels</span>
                                    <strong>{fmt(geeResult.candidate_pixels, 0)}</strong>
                                    <small>Class 1 predictions</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Valid Pixels</span>
                                    <strong>{fmt(geeResult.valid_pixels, 0)}</strong>
                                    <small>Pixels with all 6 features</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Candidate %</span>
                                    <strong>{fmt(geeResult.candidate_percentage)}</strong>
                                    <small>% of valid pixels</small>
                                </div>
                                <div className="analytics-stat-card">
                                    <span>Output File</span>
                                    <strong style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                                        {geeResult.output_filename}
                                    </strong>
                                    <small>Saved on server</small>
                                </div>
                            </div>

                            <div className="analytics-card distribution-card">
                                <div className="card-title">
                                    <div>
                                        <h2>Candidate Distribution</h2>
                                        <p>Candidate vs non-candidate valid pixels</p>
                                    </div>
                                </div>
                                <div className="distribution-bars">
                                    <div className="distribution-row">
                                        <div className="distribution-label">
                                            <span>Flood candidates (class 1)</span>
                                            <strong>{fmt(geeResult.candidate_pixels, 0)}</strong>
                                        </div>
                                        <div className="distribution-track">
                                            <div
                                                className="distribution-fill flooded"
                                                style={{
                                                    width: `${Math.min(100, Number(geeResult.candidate_percentage || 0))}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="distribution-row">
                                        <div className="distribution-label">
                                            <span>Non-candidates (class 0)</span>
                                            <strong>
                                                {fmt(
                                                    Math.max(0,
                                                        Number(geeResult.valid_pixels || 0) -
                                                        Number(geeResult.candidate_pixels || 0)
                                                    ),
                                                    0
                                                )}
                                            </strong>
                                        </div>
                                        <div className="distribution-track">
                                            <div
                                                className="distribution-fill safe"
                                                style={{
                                                    width: `${Math.max(0, 100 - Number(geeResult.candidate_percentage || 0))}%`,
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
                                        <p>Output GeoTIFF metadata</p>
                                    </div>
                                </div>
                                <div className="details-grid">
                                    <div>
                                        <span>Width × Height</span>
                                        <strong>
                                            {geeResult.raster?.width} × {geeResult.raster?.height}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>CRS</span>
                                        <strong>{geeResult.raster?.crs}</strong>
                                    </div>
                                    <div>
                                        <span>Method</span>
                                        <strong>{geeResult.method}</strong>
                                    </div>
                                    <div>
                                        <span>Features</span>
                                        <strong>{geeResult.feature_names?.join(", ")}</strong>
                                    </div>
                                </div>
                                <div
                                    className="analytics-error"
                                    style={{
                                        marginTop: 12,
                                        fontSize: "0.78rem",
                                        background: "#fef9c3",
                                        color: "#92400e",
                                        border: "1px solid #fde68a",
                                    }}
                                >
                                    {geeResult.label_warning}
                                </div>
                            </div>
                        </>
                    )}

                    {!geeResult && !geeLoading && (
                        <div className="analytics-empty">
                            <div className="empty-icon">
                                <Icon name="cpu" size={25} />
                            </div>
                            <h2>GEE RF ready</h2>
                            <p>
                                Check model status, then click{" "}
                                <strong>Run GEE RF Prediction</strong> to
                                classify the configured feature raster.
                                The feature raster (
                                <code>patna_s1_features_aug2026.tif</code>)
                                must be placed in{" "}
                                <code>EPICS--main/datasets/</code> or
                                configured via{" "}
                                <code>HYDROSHIELD_FEATURE_RASTER</code>.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default Analytics;
