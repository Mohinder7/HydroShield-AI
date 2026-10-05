import { useState } from "react";
import {
    detectFlood,
    getBundledRaster,
    getRasterInfo,
    preprocessSentinel1,
    runRFPretrained,
} from "../api";
import Icon from "../components/Icon";

function Analytics() {
    // ── Threshold tab state ──
    const [file, setFile] = useState(null);
    const [threshold, setThreshold] = useState(-17);
    const [band, setBand] = useState(1);
    const [bandCount, setBandCount] = useState(1);
    const [bandNames, setBandNames] = useState([]);
    const [valueScale, setValueScale] = useState("dB");
    const [loading, setLoading] = useState(false);
    const [preprocessing, setPreprocessing] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");
    const [safeArchive, setSafeArchive] = useState(null);

    // ── RF tab state ──
    const [activeTab, setActiveTab] = useState("threshold");
    const [rfFile, setRfFile] = useState(null);
    const [rfBand, setRfBand] = useState(1);
    const [rfValueScale, setRfValueScale] = useState("dB");
    const [rfLoading, setRfLoading] = useState(false);
    const [rfResult, setRfResult] = useState(null);
    const [rfError, setRfError] = useState("");
    const [rfAutoLoading, setRfAutoLoading] = useState(false);

    const handlePreprocess = async () => {
        if (!safeArchive) { setError("Select a zipped Sentinel-1 GRD SAFE product first."); return; }
        setPreprocessing(true); setResult(null); setError("");
        try {
            const output = await preprocessSentinel1(safeArchive);
            const info = await getRasterInfo(output);
            setFile(output); setBand(1); setBandCount(info.bands); setBandNames(info.descriptions || []); setValueScale("dB");
        } catch (e) { setError(e.message || "Sentinel-1 preprocessing failed."); }
        finally { setPreprocessing(false); }
    };

    const handleFileChange = async (event) => {
        const selectedFile = event.target.files?.[0] || null;
        setFile(selectedFile); setResult(null); setError(""); setBand(1); setBandCount(1); setBandNames([]);
        if (!selectedFile) return;
        try {
            const info = await getRasterInfo(selectedFile);
            setBandCount(info.bands); setBandNames(info.descriptions || []);
        } catch (e) { setError(e.message || "Could not inspect raster."); }
    };

    const handleAnalyze = async () => {
        if (!file) { setError("Please select a Sentinel-1 GeoTIFF file first."); return; }
        setLoading(true); setError(""); setResult(null);
        try {
            const data = await detectFlood(file, band, threshold, valueScale);
            setResult(data);
        } catch (err) { setError(err.message || "Flood analysis failed."); }
        finally { setLoading(false); }
    };

    const handleLoadBundled = async () => {
        setRfAutoLoading(true); setRfError(""); setRfResult(null);
        try {
            const f = await getBundledRaster();
            setRfFile(f);
        } catch (e) { setRfError(e.message || "Could not load bundled raster."); }
        finally { setRfAutoLoading(false); }
    };

    const handleRfFileChange = (event) => {
        const f = event.target.files?.[0] || null;
        setRfFile(f); setRfResult(null); setRfError("");
    };

    const handleRunRF = async () => {
        if (!rfFile) { setRfError("Load or upload a raster first."); return; }
        setRfLoading(true); setRfError(""); setRfResult(null);
        try {
            const data = await runRFPretrained(rfFile, rfBand, rfValueScale);
            setRfResult(data);
        } catch (e) { setRfError(e.message || "RF analysis failed."); }
        finally { setRfLoading(false); }
    };

    const fmt = (v, d = 2) => (v === undefined || v === null) ? "\u2014" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
    const fmtPct = (v) => (v === undefined || v === null) ? "\u2014" : `${Number(v).toFixed(2)}%`;

    return (
        <div className="analytics-page">
            <div className="page-heading">
                <div>
                    <h1>Flood Analytics</h1>
                    <p>Analyze Sentinel-1 SAR imagery and evaluate flood extent and risk.</p>
                </div>
            </div>

            {/* Tab switcher */}
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

            {/* ═══════════════════════════════════════════
                THRESHOLD TAB
            ════════════════════════════════════════════ */}
            {activeTab === "threshold" && (
                <div className="analytics-grid">
                    <div className="analytics-card analysis-controls">
                        <div className="card-title">
                            <div><h2>Run Flood Analysis</h2><p>Upload a Sentinel-1 GeoTIFF raster for flood detection.</p></div>
                        </div>
                        <div className="form-group preprocessing-control">
                            <label htmlFor="sentinel-safe-product">Preprocess a Sentinel-1 GRD SAFE product</label>
                            <input id="sentinel-safe-product" type="file" accept=".zip"
                                onChange={(e) => { setSafeArchive(e.target.files?.[0] || null); setFile(null); setBandCount(1); setBandNames([]); setResult(null); setError(""); }} />
                            <small>SNAP GPT applies orbit and noise correction, Sigma0 calibration, terrain correction, then dB conversion.</small>
                            <button type="button" className="primary-action" onClick={handlePreprocess} disabled={preprocessing || !safeArchive}>
                                {preprocessing ? "Preprocessing Sentinel-1..." : "Preprocess with SNAP"}
                            </button>
                        </div>
                        <div className="form-group">
                            <label>Preprocessed backscatter GeoTIFF</label>
                            <input type="file" accept=".tif,.tiff" onChange={handleFileChange} />
                            {file && <div className="selected-file"><span>Selected file</span><strong>{file.name}</strong></div>}
                        </div>
                        <div className="control-row">
                            <div className="form-group">
                                <label>SAR Band</label>
                                <select value={band} onChange={(e) => setBand(Number(e.target.value))}>
                                    {Array.from({ length: bandCount }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>
                                            {bandNames[i] && bandNames[i] !== `Band ${i + 1}` ? `Band ${i + 1} \u00b7 ${bandNames[i]}` : `Band ${i + 1}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Value Scale</label>
                                <select value={valueScale} onChange={(e) => setValueScale(e.target.value)}>
                                    <option value="dB">dB</option>
                                    <option value="Linear power">Linear power</option>
                                </select>
                            </div>
                        </div>
                        <div className="form-group">
                            <div className="label-row"><label>Flood Threshold</label><span>{threshold} dB</span></div>
                            <input type="range" min="-30" max="-5" step="0.5" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                            <div className="range-labels"><span>-30 dB</span><span>-5 dB</span></div>
                        </div>
                        <button className="primary-action" onClick={handleAnalyze} disabled={loading || !file}>
                            {loading ? "Analyzing..." : "Run Flood Analysis"}
                        </button>
                        {error && <div className="analytics-error">{error}</div>}
                    </div>

                    <div className="analytics-card method-card">
                        <div className="card-title"><div><h2>Detection Method</h2><p>Current analysis configuration</p></div></div>
                        <div className="method-item"><span>Algorithm</span><strong>Threshold-based SAR Detection</strong></div>
                        <div className="method-item"><span>Satellite Data</span><strong>Sentinel-1 SAR</strong></div>
                        <div className="method-item"><span>Input Format</span><strong>GeoTIFF</strong></div>
                        <div className="method-item"><span>Selected Band</span><strong>Band {band}</strong></div>
                        <div className="method-item"><span>Threshold</span><strong>{threshold} dB</strong></div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════
                RF TAB
            ════════════════════════════════════════════ */}
            {activeTab === "rf" && (
                <div className="analytics-grid">
                    <div className="analytics-card analysis-controls">
                        <div className="card-title">
                            <div><h2>Random Forest (Pretrained)</h2><p>No labelled data needed. Otsu thresholding auto-generates pseudo-labels from the SAR raster itself, then trains a Random Forest classifier.</p></div>
                        </div>

                        <div className="form-group">
                            <label>Load Bundled SAR Raster</label>
                            <button className="primary-action" onClick={handleLoadBundled} disabled={rfAutoLoading}>
                                {rfAutoLoading ? "Loading..." : "Use Bundled Dataset (Patna SAR)"}
                            </button>
                            {rfFile && !rfAutoLoading && <div className="selected-file"><span>Raster ready</span><strong>{rfFile.name}</strong></div>}
                        </div>

                        <div className="form-group">
                            <label>Or upload your own GeoTIFF</label>
                            <input type="file" accept=".tif,.tiff" onChange={handleRfFileChange} />
                        </div>

                        <div className="control-row">
                            <div className="form-group">
                                <label>Band</label>
                                <select value={rfBand} onChange={(e) => setRfBand(Number(e.target.value))}>
                                    <option value={1}>Band 1</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Value Scale</label>
                                <select value={rfValueScale} onChange={(e) => setRfValueScale(e.target.value)}>
                                    <option value="dB">dB</option>
                                    <option value="Linear power">Linear power</option>
                                </select>
                            </div>
                        </div>

                        <button className="primary-action" onClick={handleRunRF} disabled={rfLoading || !rfFile}>
                            {rfLoading ? "Analyzing with Random Forest..." : "Run RF Flood Analysis"}
                        </button>

                        {rfError && <div className="analytics-error">{rfError}</div>}
                    </div>

                    <div className="analytics-card method-card">
                        <div className="card-title"><div><h2>RF Method</h2><p>Unsupervised bootstrapped classification</p></div></div>
                        <div className="method-item"><span>Algorithm</span><strong>Random Forest Classifier</strong></div>
                        <div className="method-item"><span>Label Generation</span><strong>Otsu Thresholding (auto)</strong></div>
                        <div className="method-item"><span>Satellite Data</span><strong>Sentinel-1 SAR</strong></div>
                        <div className="method-item"><span>Estimators</span><strong>150 trees</strong></div>
                        <div className="method-item"><span>Validation</span><strong>20% stratified holdout</strong></div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════
                THRESHOLD RESULTS
            ════════════════════════════════════════════ */}
            {activeTab === "threshold" && result && (
                <>
                    <div className="analytics-section-heading"><div><h2>Analysis Results</h2><p>Results generated by the HydroShield AI flood-analysis backend.</p></div></div>
                    <div className="analytics-stat-grid">
                        <div className="analytics-stat-card"><span>Flooded Area</span><strong>{fmt(result.flooded_area_km2)}</strong><small>km²</small></div>
                        <div className="analytics-stat-card"><span>Flood Percentage</span><strong>{fmt(result.flooded_percentage)}</strong><small>% of valid area</small></div>
                        <div className="analytics-stat-card"><span>Risk Level</span><strong className="risk-value">{result.risk?.level || "Unavailable"}</strong><small>Prototype area-share category</small></div>
                        <div className="analytics-stat-card"><span>Flooded Pixels</span><strong>{fmt(result.flooded_pixels, 0)}</strong><small>Detected pixels</small></div>
                    </div>
                    {result.area_error && <div className="analytics-error">Area and risk reporting unavailable: {result.area_error}</div>}
                    <div className="analytics-card distribution-card">
                        <div className="card-title"><div><h2>Flood Distribution</h2><p>Distribution of detected and non-flooded valid pixels.</p></div></div>
                        <div className="distribution-bars">
                            <div className="distribution-row">
                                <div className="distribution-label"><span>Flooded</span><strong>{fmt(result.flooded_pixels, 0)}</strong></div>
                                <div className="distribution-track"><div className="distribution-fill flooded" style={{ width: `${Math.min(100, Number(result.flooded_percentage || 0))}%` }} /></div>
                            </div>
                            <div className="distribution-row">
                                <div className="distribution-label"><span>Non-flooded</span><strong>{fmt(Math.max(0, Number(result.valid_pixels || 0) - Number(result.flooded_pixels || 0)), 0)}</strong></div>
                                <div className="distribution-track"><div className="distribution-fill safe" style={{ width: `${Math.max(0, 100 - Number(result.flooded_percentage || 0))}%` }} /></div>
                            </div>
                        </div>
                    </div>
                    <div className="analytics-card">
                        <div className="card-title"><div><h2>Raster Analysis Details</h2><p>Technical information returned by the backend.</p></div></div>
                        <div className="details-grid">
                            <div><span>Total Pixels</span><strong>{fmt(result.total_pixels, 0)}</strong></div>
                            <div><span>Valid Pixels</span><strong>{fmt(result.valid_pixels, 0)}</strong></div>
                            <div><span>Threshold</span><strong>{result.threshold_db ?? threshold} dB</strong></div>
                            <div><span>Value Scale</span><strong>{result.value_scale || valueScale}</strong></div>
                        </div>
                    </div>
                </>
            )}

            {/* ═══════════════════════════════════════════
                RF RESULTS
            ════════════════════════════════════════════ */}
            {activeTab === "rf" && rfResult && (
                <>
                    <div className="analytics-section-heading"><div><h2>RF Analysis Results</h2><p>Random Forest classification with Otsu-generated pseudo-labels.</p></div></div>
                    <div className="analytics-stat-grid">
                        <div className="analytics-stat-card"><span>Flooded Area</span><strong>{fmt(rfResult.flooded_area_km2)}</strong><small>km²</small></div>
                        <div className="analytics-stat-card"><span>Flood Percentage</span><strong>{fmt(rfResult.flooded_percentage)}</strong><small>% of valid area</small></div>
                        <div className="analytics-stat-card"><span>Risk Level</span><strong className="risk-value">{rfResult.risk?.level || "Unavailable"}</strong><small>RF classification</small></div>
                        <div className="analytics-stat-card"><span>Otsu Threshold</span><strong>{fmt(rfResult.otsu_threshold_db)}</strong><small>dB (auto-detected)</small></div>
                    </div>

                    <div className="analytics-card">
                        <div className="card-title"><div><h2>Model Metrics</h2><p>Random Forest holdout evaluation (20% stratified test set).</p></div></div>
                        <div className="details-grid">
                            <div><span>Accuracy</span><strong>{fmtPct(rfResult.metrics?.accuracy * 100)}</strong></div>
                            <div><span>Precision</span><strong>{fmtPct(rfResult.metrics?.precision * 100)}</strong></div>
                            <div><span>Recall</span><strong>{fmtPct(rfResult.metrics?.recall * 100)}</strong></div>
                            <div><span>F1 Score</span><strong>{fmtPct(rfResult.metrics?.f1 * 100)}</strong></div>
                            <div><span>IoU</span><strong>{fmtPct(rfResult.metrics?.iou * 100)}</strong></div>
                            <div><span>Train / Test Pixels</span><strong>{fmt(rfResult.metrics?.train_pixels, 0)} / {fmt(rfResult.metrics?.test_pixels, 0)}</strong></div>
                        </div>
                    </div>

                    {result && (
                        <div className="analytics-card">
                            <div className="card-title"><div><h2>Method Comparison</h2><p>Threshold vs Random Forest flood detection.</p></div></div>
                            <div className="distribution-bars">
                                <div className="distribution-row">
                                    <div className="distribution-label"><span>Threshold</span><strong>{fmt(result.flooded_percentage)}%</strong></div>
                                    <div className="distribution-track"><div className="distribution-fill flooded" style={{ width: `${Math.min(100, Number(result.flooded_percentage || 0))}%` }} /></div>
                                </div>
                                <div className="distribution-row">
                                    <div className="distribution-label"><span>Random Forest</span><strong>{fmt(rfResult.flooded_percentage)}%</strong></div>
                                    <div className="distribution-track"><div className="distribution-fill" style={{ width: `${Math.min(100, Number(rfResult.flooded_percentage || 0))}%`, backgroundColor: "#6366f1" }} /></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {rfResult.area_error && <div className="analytics-error">Area reporting unavailable: {rfResult.area_error}</div>}
                </>
            )}

            {activeTab === "threshold" && !result && !loading && (
                <div className="analytics-empty">
                    <div className="empty-icon"><Icon name="chart" size={25} /></div>
                    <h2>No analysis available</h2>
                    <p>Upload a Sentinel-1 GeoTIFF above and run flood analysis to generate analytics.</p>
                </div>
            )}

            {activeTab === "rf" && !rfResult && !rfLoading && (
                <div className="analytics-empty">
                    <div className="empty-icon"><Icon name="layers" size={25} /></div>
                    <h2>No RF analysis available</h2>
                    <p>Load the bundled raster or upload one, then click Run RF Flood Analysis.</p>
                </div>
            )}
        </div>
    );
}

export default Analytics;
