from pathlib import Path
import hashlib
import tempfile

import folium
import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import rasterio
import streamlit as st
from rasterio.warp import transform as reproject_coords
from streamlit_folium import st_folium

from src.pipeline import (calculate_area, predict, raster_info, read_features, risk_summary,
                          save_mask, threshold_mask, train_random_forest)
from src.preprocessing import preprocess_sentinel1
from src.routing import load_vectors, route


def flood_webmap(mask, valid, profile, info):
    corners_x = [profile["transform"].c, profile["transform"].c + profile["transform"].a * info["width"]]
    corners_y = [profile["transform"].f, profile["transform"].f + profile["transform"].e * info["height"]]
    bx, by = reproject_coords(profile["crs"], "EPSG:4326", corners_x, corners_y)
    rgba = np.zeros((*mask.shape, 4), dtype="uint8")
    rgba[mask & valid] = [20, 100, 230, 170]
    center = [(min(by)+max(by))/2, (min(bx)+max(bx))/2]
    webmap = folium.Map(location=center, zoom_start=11, control_scale=True)
    folium.raster_layers.ImageOverlay(image=rgba, bounds=[[min(by), min(bx)], [max(by), max(bx)]],
                                       opacity=0.8, name="Flood mask").add_to(webmap)
    legend = """<div style='position:fixed;bottom:28px;left:28px;z-index:9999;background:white;padding:8px 12px;border:1px solid #888;border-radius:4px;font-size:13px'>
    <span style='display:inline-block;width:14px;height:14px;background:rgba(20,100,230,.67);margin-right:6px;vertical-align:middle'></span>Flood candidate mask</div>"""
    webmap.get_root().html.add_child(folium.Element(legend))
    folium.LayerControl().add_to(webmap)
    return webmap


st.set_page_config(page_title="HydroShield AI", layout="wide")
st.title("HydroShield AI")
st.caption("Sentinel-1 flood mapping and flood-aware community decision support · prototype")
st.info("This prototype processes historical or user-provided Sentinel-1-derived rasters. It does not provide live satellite ingestion or operational emergency services.")

with st.sidebar:
    st.header("1 · Select Sentinel-1 scene")
    raster_file = st.file_uploader(
        "GRD SAFE ZIP or preprocessed GeoTIFF",
        type=["zip", "tif", "tiff"],
    )
    if raster_file:
        raster_bytes = raster_file.getvalue()
        temp_dir = Path(tempfile.gettempdir()) / "hydroshield_ai"
        temp_dir.mkdir(exist_ok=True)
        if Path(raster_file.name).suffix.lower() == ".zip":
            source_id = hashlib.sha256(raster_bytes).hexdigest()
            source_path = temp_dir / f"{source_id}.zip"
            source_path.write_bytes(raster_bytes)
            processed_id = st.session_state.get("processed_safe_id")
            processed_path = st.session_state.get("processed_safe_path")
            if processed_id != source_id or not processed_path or not Path(processed_path).is_file():
                st.info(
                    "Preprocessing runs SNAP GPT locally. SNAP with the Sentinel-1 toolbox "
                    "and SRTM DEM access must be installed and configured."
                )
                if st.button("Preprocess GRD SAFE with SNAP"):
                    output_path = temp_dir / f"{source_id}_backscatter.tif"
                    try:
                        with st.spinner("Applying orbit and noise correction, calibration, and terrain correction..."):
                            preprocess_sentinel1(source_path, output_path)
                        st.session_state["processed_safe_id"] = source_id
                        st.session_state["processed_safe_path"] = str(output_path)
                        st.rerun()
                    except (OSError, RuntimeError, ValueError) as exc:
                        st.error(f"Sentinel-1 preprocessing failed: {exc}")
                raster_path = None
            else:
                raster_path = Path(processed_path)
        else:
            raster_path = temp_dir / Path(raster_file.name).name
            raster_path.write_bytes(raster_bytes)
    else:
        raster_path = None

if raster_path:
    try:
        info = raster_info(raster_path)
        st.subheader("Scene inspection")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Raster size", f"{info['width']} × {info['height']}")
        c2.metric("Bands", info["bands"])
        c3.metric("CRS", info["crs"])
        c4.metric("Type", info["dtype"])
        names = [d if d else f"Band {i+1}" for i, d in enumerate(info["descriptions"])]
        if len(names) == 1:
            selected = [1]
        else:
            selected_names = st.multiselect("SAR feature bands (identify VV/VH from your metadata)", names, default=names[:1])
            selected = [names.index(x)+1 for x in selected_names]
        if not selected:
            st.warning("Select at least one band to continue.")
            st.stop()
        value_scale = st.selectbox("Backscatter value scale (check the product metadata)", ["dB", "Linear power"])
        features, valid, profile = read_features(raster_path, selected)
        if not valid.any():
            st.error("The selected raster bands contain no valid pixels.")
            st.stop()
        with st.expander("Input preview and metadata"):
            st.write({k: v for k, v in info.items() if k != "transform"})
            fig, ax = plt.subplots(figsize=(8, 5))
            ax.imshow(features[..., 0], cmap="gray", vmin=np.nanpercentile(features[..., 0], 2), vmax=np.nanpercentile(features[..., 0], 98))
            ax.set_title(names[selected[0]-1] + " · first selected band")
            ax.axis("off")
            st.pyplot(fig)
            plt.close(fig)

        st.header("2 · Flood detection")
        method = st.radio("Detection method", ["Exploratory SAR threshold", "Train Random Forest from aligned labels"], horizontal=True)
        if method.startswith("Exploratory"):
            threshold = st.slider("Backscatter threshold (dB)", -30.0, -5.0, -17.0, 0.5,
                                  help="Prototype heuristic only. A low-backscatter signature is not sufficient to validate floodwater.")
            mask, _ = threshold_mask(features, valid, threshold, value_scale)
            st.caption("Method: pixels in the selected band below the chosen dB threshold. This exploratory water-candidate mask may confuse permanent water, shadows, and other low-backscatter surfaces with floodwater.")
        else:
            label_file = st.file_uploader("Aligned label GeoTIFF (0 non-flood, 1 flood)", type=["tif", "tiff"], key="labels")
            if not label_file:
                st.warning("Training requires a label raster spatially aligned to this scene. No mask or result has been generated yet.")
                st.stop()
            label_path = temp_dir / ("labels_" + label_file.name)
            label_path.write_bytes(label_file.getvalue())
            with rasterio.open(label_path) as labels_ds:
                labels = labels_ds.read(1, masked=True).filled(255)
                if labels.shape != valid.shape or labels_ds.transform != profile["transform"] or labels_ds.crs != profile["crs"]:
                    st.error("Labels must exactly match the scene dimensions, transform, and CRS. Reproject/resample labels before use.")
                    st.stop()
            try:
                model, train_valid, metrics = train_random_forest(features, valid, labels, value_scale)
                mask = predict(model, features, valid, value_scale)
                st.success(f"Random Forest trained on {metrics['train_pixels']:,} pixels and evaluated on {metrics['test_pixels']:,} stratified random holdout pixels.")
                st.caption("These are within-scene random-pixel holdout metrics; spatially independent validation is recommended because nearby pixels can be correlated.")
                m1, m2, m3, m4, m5 = st.columns(5)
                m1.metric("Accuracy", f"{metrics['accuracy']:.3f}")
                m2.metric("Precision", f"{metrics['precision']:.3f}")
                m3.metric("Recall", f"{metrics['recall']:.3f}")
                m4.metric("F1", f"{metrics['f1']:.3f}")
                m5.metric("IoU", f"{metrics['iou']:.3f}")
            except ValueError as exc:
                st.error(str(exc)); st.stop()

        st.header("3 · Flood mask and risk")
        mask_profile = profile.copy()
        out_dir = Path("outputs")
        (out_dir / "flood_masks").mkdir(parents=True, exist_ok=True)
        mask_path = out_dir / "flood_masks" / "latest_flood_mask.tif"
        save_mask(mask_path, mask, mask_profile, valid)
        flooded_pixels = int(mask.sum())
        c1, c2, c3 = st.columns(3)
        c1.metric("Flood candidate pixels", f"{flooded_pixels:,}")
        c2.metric("Valid pixels", f"{int(valid.sum()):,}")
        percent = 100 * flooded_pixels / max(int(valid.sum()), 1)
        c3.metric("Share of valid pixels", f"{percent:.2f}%")
        try:
            area = calculate_area(mask & valid, profile)
            total = calculate_area(valid, profile)
            risk = risk_summary(area, total, percent)
            c1.metric("Candidate area", f"{area:.3f} km²")
            st.metric("Prototype area-share category", risk["level"])
            st.caption(risk["rule"] + " This is an illustrative rule, not a validated flood hazard classification.")
        except ValueError as exc:
            st.warning(f"Area and risk category unavailable: {exc}")
            risk = None

        fig, ax = plt.subplots(figsize=(9, 6))
        ax.imshow(features[..., 0], cmap="gray", vmin=np.nanpercentile(features[..., 0], 2), vmax=np.nanpercentile(features[..., 0], 98))
        overlay = np.ma.masked_where(~mask, mask)
        ax.imshow(overlay, cmap="Blues", alpha=0.7, vmin=0, vmax=1)
        ax.set_title("Flood mask overlay · blue = classified flooded")
        ax.axis("off")
        st.pyplot(fig); plt.close(fig)
        st.download_button("Download flood mask GeoTIFF", mask_path.read_bytes(), file_name="hydroshield_flood_mask.tif", mime="image/tiff")
        st.subheader("Flood map")
        st_folium(flood_webmap(mask, valid, profile, info), use_container_width=True, height=500)

        st.header("4 · Flood alert notifications")
        if flooded_pixels == 0:
            st.success("No pixels met the selected detection rule. This does not confirm that the area is flood-free.")
        elif risk:
            if risk["level"] == "High Risk":
                st.error(f"Flood Alert · High prototype area-share category in this scene ({area:.3f} km² candidate area). Avoid affected roads and follow local emergency guidance.")
            elif risk["level"] == "Moderate Risk":
                st.warning(f"Flood Alert · Moderate prototype area-share category in this scene ({area:.3f} km² candidate area). Check local conditions before travel.")
            else:
                st.info(f"Flood Alert · Low prototype area-share category in this scene ({area:.3f} km² candidate area). Continue monitoring local advisories.")
        else:
            st.warning(f"{flooded_pixels:,} pixels classified; no area-based risk alert can be calculated for this CRS.")

        st.header("5 · Flood-aware road overlay and shelter routing")
        colr, cols = st.columns(2)
        roads_file = colr.file_uploader("Roads (GeoJSON, GPKG, Shapefile ZIP)", type=["geojson", "json", "gpkg", "zip"], key="roads")
        shelters_file = cols.file_uploader("Shelters (GeoJSON, GPKG, or Shapefile ZIP)", type=["geojson", "json", "gpkg", "zip"], key="shelters")
        start_enabled = st.checkbox("Set a start location")
        lon = st.number_input("Start longitude", min_value=-180.0, max_value=180.0, value=0.0, format="%.6f", disabled=not start_enabled)
        lat = st.number_input("Start latitude", min_value=-90.0, max_value=90.0, value=0.0, format="%.6f", disabled=not start_enabled)
        st.caption("Enter a real start point in WGS84 coordinates. Road and shelter layers must include CRS metadata. Routing is available only when compatible vector data is supplied.")
        if roads_file and shelters_file:
            roads_path = temp_dir / ("roads_" + roads_file.name); roads_path.write_bytes(roads_file.getvalue())
            shelters_path = temp_dir / ("shelters_" + shelters_file.name); shelters_path.write_bytes(shelters_file.getvalue())
            try:
                roads, shelters = load_vectors(roads_path, shelters_path, profile["crs"])
                if start_enabled:
                    x, y = reproject_coords("EPSG:4326", profile["crs"], [lon], [lat])
                    result, _, road_parts, flooded_roads = route(roads, shelters, mask, valid, profile["transform"], (x[0], y[0]), raster_crs=profile["crs"])
                else:
                    result, road_parts, flooded_roads = None, [], []
                if result:
                    shelter_name = shelters.loc[result['shelter_index']].get('name', 'Shelter')
                    unit = profile["crs"].linear_units if profile["crs"].is_projected else "CRS units"
                    st.success(f"Nearest reachable shelter: {shelter_name}. Network distance: {result['length_m']:.0f} {unit}.")
                    st.caption(f"Excluded road segments flagged as affected: {sum(flooded_roads)}. Route is calculated over supplied road geometry and the mask's pixel samples; verify against current local conditions.")
                elif start_enabled:
                    st.error("No safe route available from the selected location.")
                else:
                    st.info("Set a start location to enable nearest-shelter route calculation.")
                webmap = flood_webmap(mask, valid, profile, info)
                if road_parts:
                    screened_roads = gpd.GeoDataFrame(
                        {"screening": ["Excluded: flood or unknown coverage" if bad else "Available"] for bad in flooded_roads},
                        geometry=road_parts, crs=profile["crs"]
                    ).to_crs("EPSG:4326")
                    folium.GeoJson(screened_roads, name="Road screening",
                                   style_function=lambda feature: {"color": "#d62728" if feature["properties"]["screening"].startswith("Excluded") else "#777777", "weight": 3},
                                   tooltip=folium.GeoJsonTooltip(fields=["screening"])).add_to(webmap)
                shelters_wgs = shelters.to_crs("EPSG:4326")
                shelter_tooltip = folium.GeoJsonTooltip(fields=["name"]) if "name" in shelters_wgs.columns else None
                folium.GeoJson(shelters_wgs, name="Supplied shelters", marker=folium.CircleMarker(radius=5, color="green"),
                               tooltip=shelter_tooltip).add_to(webmap)
                if result:
                    rx, ry = reproject_coords(profile["crs"], "EPSG:4326", [p[0] for p in result["coordinates"]], [p[1] for p in result["coordinates"]])
                    folium.PolyLine(list(zip(ry, rx)), color="lime", weight=5, tooltip="Recommended route").add_to(webmap)
                    sx, sy = reproject_coords(profile["crs"], "EPSG:4326", [result["shelter"].x], [result["shelter"].y])
                    folium.Marker([sy[0], sx[0]], tooltip="Selected shelter", icon=folium.Icon(color="green", icon="home")).add_to(webmap)
                if start_enabled:
                    folium.Marker([lat, lon], tooltip="Start location", icon=folium.Icon(color="blue")).add_to(webmap)
                st_folium(webmap, use_container_width=True, height=550)
            except Exception as exc:
                st.error(f"Routing could not be calculated: {exc}")
        else:
            st.info("Add both road and shelter datasets to enable map and route analysis. No shelter or route is assumed.")
    except Exception as exc:
        st.error(f"Could not process this raster: {exc}")
else:
    st.markdown("### Workflow\n**Sentinel-1 scene → preprocessing → flood mask → area-share analysis → risk-based notification → road overlay → shelter route**")
    st.write("Upload a zipped Sentinel-1 GRD SAFE product and preprocess it with SNAP GPT, or upload a calibrated, georeferenced backscatter GeoTIFF.")

st.divider()
st.caption("Prototype limitations: no scenes, labeled training data, roads, or shelter layers are bundled. Threshold and risk rules are demonstrative. Routing requires user-provided, CRS-tagged data and is not an emergency service.")
