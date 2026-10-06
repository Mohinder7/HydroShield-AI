"""Repeatable SNAP GPT preprocessing for Sentinel-1 GRD SAFE products."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import rasterio
from pyproj import CRS


SUPPORTED_POLARISATIONS = {"VV", "VH", "HH", "HV"}
GPT_TIMEOUT_SECONDS = 1800


class SnapUnavailableError(RuntimeError):
    """Raised when the SNAP Graph Processing Tool cannot be found."""


class SnapProcessingError(RuntimeError):
    """Raised when SNAP fails to produce a usable backscatter raster."""


def find_gpt_executable(configured_path: str | None = None) -> str:
    """Find the SNAP Graph Processing Tool from configuration or PATH."""
    value = configured_path or os.getenv("SNAP_GPT_PATH")
    if value:
        candidate = Path(value.strip().strip('"'))
        if candidate.is_dir():
            candidate = candidate / "bin" / ("gpt.exe" if os.name == "nt" else "gpt")
        if candidate.is_file():
            return str(candidate)
        located = shutil.which(value.strip().strip('"'))
        if located:
            return located
        raise SnapUnavailableError(
            f"SNAP_GPT_PATH does not point to a SNAP gpt executable: {value}"
        )

    located = shutil.which("gpt")
    if located:
        return located

    raise SnapUnavailableError(
        "SNAP Graph Processing Tool was not found. Install ESA SNAP with the "
        "Sentinel-1 toolbox, then set SNAP_GPT_PATH to its gpt.exe file "
        "(for example, C:\\Program Files\\esa-snap\\bin\\gpt.exe)."
    )


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _read_safe_metadata(source: Path) -> tuple[set[str], list[tuple[float, float]]]:
    """Read SAFE polarisation and geolocation metadata without extracting a ZIP."""
    if source.is_dir():
        manifest = source / "manifest.safe"
        if not manifest.is_file():
            raise ValueError("The selected folder is not a Sentinel-1 SAFE product: manifest.safe is missing.")
        annotation_files = list((source / "annotation").glob("*.xml"))
        manifest_content = manifest.read_bytes()

        def read_annotation(path: Path) -> bytes:
            return path.read_bytes()
    elif zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            files = archive.infolist()
            manifests = [
                info for info in files
                if Path(info.filename).name.lower() == "manifest.safe"
            ]
            if len(manifests) != 1:
                raise ValueError(
                    "The ZIP must contain exactly one Sentinel-1 manifest.safe file."
                )
            manifest_info = manifests[0]
            manifest_root = manifest_info.filename.rsplit("/", 1)[0] if "/" in manifest_info.filename else ""
            measurement_prefix = f"{manifest_root}/measurement/".strip("/")
            has_measurement = any(
                info.filename.lower().startswith(measurement_prefix.lower() + "/")
                and info.filename.lower().endswith((".tif", ".tiff"))
                for info in files
            )
            if not has_measurement:
                raise ValueError(
                    "The SAFE archive contains no Sentinel-1 measurement TIFFs."
                )
            if manifest_info.file_size > 32 * 1024 * 1024:
                raise ValueError("The SAFE manifest is unexpectedly large.")
            manifest_content = archive.read(manifest_info)
            annotation_infos = [
                info for info in files
                if info.filename.lower().startswith(
                    f"{manifest_root}/annotation/".lower()
                )
                and info.filename.lower().endswith(".xml")
                and info.file_size <= 32 * 1024 * 1024
            ]

            def read_annotation(info: zipfile.ZipInfo) -> bytes:
                return archive.read(info)

            polarisations = _parse_polarisations(manifest_content)
            coordinates = []
            for info in annotation_infos:
                coordinates.extend(_parse_geolocation(read_annotation(info)))
                if coordinates:
                    break
            _validate_metadata(polarisations, coordinates)
            return polarisations, coordinates
    else:
        raise ValueError(
            "Select a zipped Sentinel-1 GRD SAFE product. ZIP archives must include "
            "manifest.safe and measurement TIFFs."
        )

    polarisations = _parse_polarisations(manifest_content)
    coordinates = []
    for annotation in annotation_files:
        coordinates.extend(_parse_geolocation(read_annotation(annotation)))
        if coordinates:
            break
    _validate_metadata(polarisations, coordinates)
    return polarisations, coordinates


def _parse_polarisations(manifest: bytes) -> set[str]:
    try:
        root = ET.fromstring(manifest)
    except ET.ParseError as exc:
        raise ValueError(f"Could not parse the SAFE manifest: {exc}") from exc

    polarisation = {
        (element.text or "").strip().upper()
        for element in root.iter()
        if _local_name(element.tag) == "transmitterReceiverPolarisation"
    }
    polarisation &= SUPPORTED_POLARISATIONS
    if not polarisation:
        raise ValueError(
            "The SAFE manifest has no supported VV, VH, HH, or HV polarisation metadata."
        )
    return polarisation


def _parse_geolocation(annotation: bytes) -> list[tuple[float, float]]:
    try:
        root = ET.fromstring(annotation)
    except ET.ParseError:
        return []

    coordinates = []
    for point in root.iter():
        if _local_name(point.tag) != "geolocationGridPoint":
            continue
        values = {
            _local_name(child.tag): child.text
            for child in point
        }
        try:
            latitude = float(values["latitude"])
            longitude = float(values["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if -90 <= latitude <= 90 and -180 <= longitude <= 180:
            coordinates.append((latitude, longitude))
    return coordinates


def _validate_metadata(
    polarisations: set[str],
    coordinates: list[tuple[float, float]],
) -> None:
    if not polarisations:
        raise ValueError(
            "The SAFE manifest has no supported VV, VH, HH, or HV polarisation metadata."
        )
    if not coordinates:
        raise ValueError(
            "Could not read the product's geolocation grid. Confirm this is a complete "
            "Sentinel-1 GRD SAFE archive, including its annotation XML files."
        )


def _utm_crs(coordinates: list[tuple[float, float]]) -> CRS:
    latitude = float(np.median([point[0] for point in coordinates]))
    longitude = float(np.median([point[1] for point in coordinates]))
    if not -80 <= latitude <= 84:
        raise ValueError(
            "Automatic UTM terrain correction is supported only between 80°S and 84°N."
        )
    zone = min(60, max(1, int((longitude + 180) // 6) + 1))
    epsg = (32600 if latitude >= 0 else 32700) + zone
    return CRS.from_epsg(epsg)


def _add_node(
    graph: ET.Element,
    node_id: str,
    operator: str,
    source: str | None,
    params: dict[str, str],
) -> None:
    node = ET.SubElement(graph, "node", id=node_id)
    ET.SubElement(node, "operator").text = operator
    sources = ET.SubElement(node, "sources")
    if source:
        ET.SubElement(sources, "sourceProduct", refid=source)
    parameters = ET.SubElement(node, "parameters")
    for key, value in params.items():
        ET.SubElement(parameters, key).text = value


def build_preprocessing_graph(
    output_crs: CRS,
    polarisations: set[str],
    pixel_spacing_m: int = 10,
) -> str:
    """Build a GRD graph that terrain-corrects linear Sigma0 before converting to dB."""
    if pixel_spacing_m not in (10, 20, 40):
        raise ValueError("Pixel spacing must be 10, 20, or 40 metres.")
    selected = ",".join(
        polarisation
        for polarisation in ("VV", "VH", "HH", "HV")
        if polarisation in polarisations
    )
    if not selected:
        raise ValueError("The SAFE product has no supported polarisation to process.")
    authority = output_crs.to_authority()
    if authority is None:
        raise ValueError(
            "SNAP terrain correction requires a CRS with an authority code, such as EPSG:32645."
        )

    graph = ET.Element("graph", id="HydroShieldSentinel1GRD")
    ET.SubElement(graph, "version").text = "1.0"
    _add_node(
        graph,
        "Read",
        "Read",
        None,
        {"file": "${input}", "formatName": "SENTINEL-1"},
    )
    _add_node(
        graph,
        "Apply-Orbit-File",
        "Apply-Orbit-File",
        "Read",
        {
            "orbitType": "Sentinel Precise (Auto Download)",
            "polyDegree": "3",
            "continueOnFail": "false",
        },
    )
    _add_node(
        graph,
        "Remove-GRD-Border-Noise",
        "Remove-GRD-Border-Noise",
        "ThermalNoiseRemoval",
        {
            "selectedPolarisations": selected,
            "borderLimit": "500",
            "trimThreshold": "0.5",
        },
    )
    _add_node(
        graph,
        "ThermalNoiseRemoval",
        "ThermalNoiseRemoval",
        "Apply-Orbit-File",
        {
            "selectedPolarisations": selected,
            "removeThermalNoise": "true",
            "outputNoise": "false",
            "reIntroduceThermalNoise": "false",
        },
    )
    _add_node(
        graph,
        "Calibration",
        "Calibration",
        "Remove-GRD-Border-Noise",
        {
            "outputSigmaBand": "true",
            "outputBetaBand": "false",
            "outputGammaBand": "false",
            "selectedPolarisations": selected,
            "outputImageInComplex": "false",
            "outputImageScaleInDb": "false",
        },
    )
    _add_node(
        graph,
        "Terrain-Correction",
        "Terrain-Correction",
        "Calibration",
        {
            "demName": "SRTM 3Sec",
            "demResamplingMethod": "BILINEAR_INTERPOLATION",
            "imgResamplingMethod": "BILINEAR_INTERPOLATION",
            "pixelSpacingInMeter": str(pixel_spacing_m),
            "mapProjection": f"{authority[0]}:{authority[1]}",
            "saveSelectedSourceBand": "true",
        },
    )
    sigma_bands = ",".join(
        f"Sigma0_{polarisation}"
        for polarisation in ("VV", "VH", "HH", "HV")
        if polarisation in polarisations
    )
    _add_node(
        graph,
        "LinearToFromdB",
        "LinearToFromdB",
        "Terrain-Correction",
        {"sourceBands": sigma_bands},
    )
    _add_node(
        graph,
        "Write",
        "Write",
        "LinearToFromdB",
        {"file": "${output}", "formatName": "BEAM-DIMAP"},
    )
    return ET.tostring(graph, encoding="unicode")


def _validate_output(path: Path, polarisations: set[str]) -> dict[str, object]:
    if not path.is_file() or path.stat().st_size == 0:
        raise SnapProcessingError(
            "SNAP finished without producing a GeoTIFF. Check that the SAFE product "
            "is complete and that SNAP can download orbit and SRTM DEM files."
        )
    try:
        with rasterio.open(path, "r+") as dataset:
            if dataset.crs is None or not dataset.crs.is_projected:
                raise SnapProcessingError(
                    "SNAP output has no projected CRS. Terrain correction did not complete."
                )
            values = dataset.read(
                1,
                masked=True,
                out_shape=(min(dataset.height, 256), min(dataset.width, 256)),
            )
            valid = values.compressed()
            if not valid.size or not np.isfinite(valid).any():
                raise SnapProcessingError(
                    "SNAP output contains no valid backscatter pixels."
                )
            if not np.any(valid != 0):
                raise SnapProcessingError(
                    "SNAP output is zero-valued. Check the source product and SNAP processing log."
                )
            names = [
                name for name in ("VV", "VH", "HH", "HV")
                if name in polarisations
            ]
            for index, polarisation in enumerate(names[:dataset.count], start=1):
                dataset.set_band_description(index, f"Sigma0_{polarisation}_dB")
            dataset.update_tags(
                PROCESSING_LEVEL="Sentinel-1 GRD Sigma0 dB",
                PREPROCESSING="SNAP GPT: orbit correction, thermal-noise removal, calibration, terrain correction",
            )
            return {
                "width": dataset.width,
                "height": dataset.height,
                "bands": dataset.count,
                "crs": dataset.crs.to_string(),
                "dtype": dataset.dtypes[0],
            }
    except rasterio.errors.RasterioError as exc:
        raise SnapProcessingError(
            f"SNAP output could not be opened as a GeoTIFF: {exc}"
        ) from exc


def _convert_to_bigtiff(
    source_path: Path,
    output_path: Path,
    polarisations: set[str],
) -> None:
    """Convert SNAP's DIMAP product to a tiled, compressed BigTIFF by row windows."""
    try:
        with rasterio.open(source_path) as source:
            if source.crs is None or not source.crs.is_projected:
                raise SnapProcessingError(
                    "SNAP intermediate has no projected CRS. Terrain correction did not complete."
                )
            profile = source.profile.copy()
            profile.update(
                driver="GTiff",
                count=source.count,
                dtype=source.dtypes[0],
                tiled=True,
                blockxsize=512,
                blockysize=512,
                compress="deflate",
                predictor=3 if source.dtypes[0].startswith("float") else 2,
                BIGTIFF="YES",
            )
            descriptions = list(source.descriptions)
            if source.count == len(polarisations):
                descriptions = [
                    f"Sigma0_{polarisation}_dB"
                    for polarisation in ("VV", "VH", "HH", "HV")
                    if polarisation in polarisations
                ]

            with rasterio.open(output_path, "w", **profile) as destination:
                for band_index in range(1, source.count + 1):
                    destination.set_band_description(
                        band_index,
                        descriptions[band_index - 1]
                        or f"Band {band_index}",
                    )
                    for row in range(0, source.height, 256):
                        height = min(256, source.height - row)
                        window = rasterio.windows.Window(
                            0,
                            row,
                            source.width,
                            height,
                        )
                        destination.write(
                            source.read(band_index, window=window),
                            band_index,
                            window=window,
                        )
                destination.update_tags(
                    PROCESSING_LEVEL="Sentinel-1 GRD Sigma0 dB",
                    PREPROCESSING=(
                        "SNAP GPT: orbit correction, thermal-noise removal, "
                        "GRD border-noise removal, calibration, terrain correction"
                    ),
                )
    except rasterio.errors.RasterioError as exc:
        raise SnapProcessingError(
            f"Could not convert SNAP's DIMAP intermediate to BigTIFF: {exc}"
        ) from exc


def _snap_process_environment(work_dir: Path, auxiliary_data_dir: Path) -> dict[str, str]:
    """Keep SNAP's temporary files and downloaded auxiliary data beside its output."""
    environment = os.environ.copy()
    environment.update(
        {
            "TEMP": str(work_dir),
            "TMP": str(work_dir),
            "TMPDIR": str(work_dir),
        }
    )
    snap_options = (
        f'-Djava.io.tmpdir="{work_dir}" '
        f'-DAuxDataPath="{auxiliary_data_dir}"'
    )
    environment["JAVA_TOOL_OPTIONS"] = " ".join(
        value
        for value in (environment.get("JAVA_TOOL_OPTIONS", "").strip(), snap_options)
        if value
    )
    return environment


def preprocess_sentinel1(
    source: Path,
    output: Path,
    gpt_path: str | None = None,
    pixel_spacing_m: int = 10,
    timeout_seconds: int = GPT_TIMEOUT_SECONDS,
) -> dict[str, object]:
    """Run the standard SNAP GRD preprocessing graph and validate its output."""
    source = Path(source)
    output = Path(output)
    if not source.is_file() and not source.is_dir():
        raise ValueError(f"Sentinel-1 input does not exist: {source}")

    polarisations, coordinates = _read_safe_metadata(source)
    output_crs = _utm_crs(coordinates)
    executable = find_gpt_executable(gpt_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    auxiliary_data_dir = output.parent / "snap_auxdata"
    auxiliary_data_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="hydroshield_snap_",
        dir=output.parent,
    ) as work_dir:
        intermediate_path = Path(work_dir) / "hydroshield_sentinel1.dim"
        graph_path = Path(work_dir) / "sentinel1_grd.xml"
        graph_path.write_text(
            build_preprocessing_graph(output_crs, polarisations, pixel_spacing_m),
            encoding="utf-8",
        )
        try:
            process = subprocess.run(
                [
                    executable,
                    "-c",
                    "268435456",
                    "-q",
                    "1",
                    "-x",
                    str(graph_path),
                    f"-Pinput={source.resolve()}",
                    f"-Poutput={intermediate_path.resolve()}",
                ],
                env=_snap_process_environment(
                    Path(work_dir),
                    auxiliary_data_dir,
                ),
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise SnapProcessingError(
                f"SNAP preprocessing exceeded the {timeout_seconds}-second time limit. "
                "Check SNAP's memory settings and the product size, then retry."
            ) from exc
        except OSError as exc:
            raise SnapProcessingError(
                f"Could not start SNAP GPT at '{executable}': {exc}"
            ) from exc

        if process.returncode != 0:
            log = (process.stderr or process.stdout or "").strip()
            if len(log) > 8000:
                log = log[-8000:]
            raise SnapProcessingError(
                f"SNAP GPT exited with code {process.returncode}."
                + (f" SNAP log:\n{log}" if log else " No diagnostic output was produced.")
            )

        if not intermediate_path.is_file():
            raise SnapProcessingError(
                "SNAP completed without writing its DIMAP intermediate product."
            )
        _convert_to_bigtiff(intermediate_path, output, polarisations)

    result = _validate_output(output, polarisations)
    result.update(
        {
            "polarizations": [
                name for name in ("VV", "VH", "HH", "HV")
                if name in polarisations
            ],
            "output_crs": output_crs.to_string(),
            "pixel_spacing_m": pixel_spacing_m,
            "value_scale": "dB",
        }
    )
    return result
