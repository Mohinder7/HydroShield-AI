import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import CRS

from src.preprocessing import (
    SnapProcessingError,
    _read_safe_metadata,
    _snap_process_environment,
    _utm_crs,
    _validate_output,
    build_preprocessing_graph,
    find_gpt_executable,
    preprocess_sentinel1,
    _convert_to_bigtiff,
)


class SentinelPreprocessingTests(unittest.TestCase):
    def test_snap_process_environment_uses_output_volume_for_temporary_data(self):
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory) / "work"
            auxiliary_data_dir = Path(directory) / "snap_auxdata"
            with patch.dict(
                "os.environ",
                {"JAVA_TOOL_OPTIONS": "-Xmx4096m"},
                clear=True,
            ):
                environment = _snap_process_environment(
                    work_dir,
                    auxiliary_data_dir,
                )

        self.assertEqual(environment["TEMP"], str(work_dir))
        self.assertEqual(environment["TMP"], str(work_dir))
        self.assertEqual(environment["TMPDIR"], str(work_dir))
        self.assertIn("-Xmx4096m", environment["JAVA_TOOL_OPTIONS"])
        self.assertIn(
            f'-Djava.io.tmpdir="{work_dir}"',
            environment["JAVA_TOOL_OPTIONS"],
        )
        self.assertIn(
            f'-DAuxDataPath="{auxiliary_data_dir}"',
            environment["JAVA_TOOL_OPTIONS"],
        )

    def test_reads_polarisations_and_scene_geolocation_from_safe_zip(self):
        manifest = b"""<root>
          <transmitterReceiverPolarisation>VV</transmitterReceiverPolarisation>
          <transmitterReceiverPolarisation>VH</transmitterReceiverPolarisation>
        </root>"""
        annotation = b"""<root><geolocationGridPoint>
          <latitude>25.5</latitude><longitude>85.2</longitude>
        </geolocationGridPoint></root>"""

        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "scene.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("scene.SAFE/manifest.safe", manifest)
                archive.writestr(
                    "scene.SAFE/measurement/s1-vv.tiff",
                    b"measurement-placeholder",
                )
                archive.writestr(
                    "scene.SAFE/annotation/s1-vv.xml",
                    annotation,
                )

            polarisations, coordinates = _read_safe_metadata(archive_path)

        self.assertEqual(polarisations, {"VV", "VH"})
        self.assertEqual(coordinates, [(25.5, 85.2)])

    def test_selects_scene_local_utm_projection(self):
        self.assertEqual(_utm_crs([(25.5, 85.2)]).to_epsg(), 32645)
        self.assertEqual(_utm_crs([(-33.9, 18.4)]).to_epsg(), 32734)

    def test_graph_has_repeatable_grd_preprocessing_steps(self):
        from pyproj import CRS

        graph = build_preprocessing_graph(
            CRS.from_epsg(32645),
            {"VV", "VH"},
        )
        self.assertIn("<formatName>SENTINEL-1</formatName>", graph)
        self.assertIn("<operator>Apply-Orbit-File</operator>", graph)
        self.assertIn("<operator>ThermalNoiseRemoval</operator>", graph)
        self.assertIn("<operator>Remove-GRD-Border-Noise</operator>", graph)
        self.assertIn("<operator>Calibration</operator>", graph)
        self.assertIn("<operator>Terrain-Correction</operator>", graph)
        self.assertIn("<outputImageScaleInDb>false</outputImageScaleInDb>", graph)
        self.assertIn("<operator>LinearToFromdB</operator>", graph)
        self.assertIn("<sourceBands>Sigma0_VV,Sigma0_VH</sourceBands>", graph)
        self.assertIn("<mapProjection>EPSG:32645</mapProjection>", graph)
        self.assertIn("<formatName>BEAM-DIMAP</formatName>", graph)
        self.assertIn("<pixelSpacingInMeter>10</pixelSpacingInMeter>", graph)

    def test_converts_snap_raster_to_compressed_bigtiff(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.tif"
            output_path = Path(directory) / "output.tif"
            profile = {
                "driver": "GTiff",
                "height": 8,
                "width": 8,
                "count": 1,
                "dtype": "float32",
                "crs": "EPSG:32645",
                "transform": from_origin(500000, 2800000, 10, 10),
            }
            values = np.arange(64, dtype="float32").reshape((8, 8)) - 20
            with rasterio.open(source_path, "w", **profile) as source:
                source.write(values, 1)
                source.set_band_description(1, "Sigma0_VV")

            _convert_to_bigtiff(source_path, output_path, {"VV"})

            with rasterio.open(output_path) as output:
                self.assertEqual(output.crs.to_epsg(), 32645)
                self.assertEqual(output.descriptions, ("Sigma0_VV_dB",))
                self.assertEqual(output.tags()["PREPROCESSING"].split(":")[0], "SNAP GPT")
                np.testing.assert_array_equal(output.read(1), values)
                self.assertEqual(output.tags(ns="IMAGE_STRUCTURE")["COMPRESSION"], "DEFLATE")

    def test_rejects_zero_valued_snap_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "output.tif"
            profile = {
                "driver": "GTiff",
                "height": 4,
                "width": 4,
                "count": 1,
                "dtype": "float32",
                "crs": "EPSG:32645",
                "transform": from_origin(500000, 2800000, 10, 10),
            }
            with rasterio.open(output_path, "w", **profile) as output:
                output.write(np.zeros((4, 4), dtype="float32"), 1)

            with self.assertRaisesRegex(SnapProcessingError, "zero-valued"):
                _validate_output(output_path, {"VV"})

    def test_gpt_configuration_error_names_expected_setting(self):
        with self.assertRaisesRegex(RuntimeError, "SNAP_GPT_PATH"):
            find_gpt_executable(r"C:\missing\gpt.exe")

    def test_preprocess_runs_graph_and_returns_projected_backscatter(self):
        manifest = b"""<root>
          <transmitterReceiverPolarisation>VV</transmitterReceiverPolarisation>
        </root>"""
        annotation = b"""<root><geolocationGridPoint>
          <latitude>25.5</latitude><longitude>85.2</longitude>
        </geolocationGridPoint></root>"""

        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "scene.zip"
            output_path = Path(directory) / "backscatter.tif"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("scene.SAFE/manifest.safe", manifest)
                archive.writestr(
                    "scene.SAFE/measurement/s1-vv.tiff",
                    b"measurement-placeholder",
                )
                archive.writestr(
                    "scene.SAFE/annotation/s1-vv.xml",
                    annotation,
                )

            def fake_gpt(command, **kwargs):
                graph_file = next(argument for argument in command if argument.endswith(".xml"))
                self.assertEqual(Path(graph_file).name, "sentinel1_grd.xml")
                self.assertEqual(command[command.index("-c") + 1], "268435456")
                self.assertEqual(command[command.index("-q") + 1], "1")
                self.assertIn("-x", command)
                self.assertEqual(kwargs["timeout"], 1800)
                self.assertTrue(kwargs["capture_output"])
                work_dir = Path(graph_file).parent
                self.assertEqual(kwargs["env"]["TEMP"], str(work_dir))
                self.assertIn(
                    f'-Djava.io.tmpdir="{work_dir}"',
                    kwargs["env"]["JAVA_TOOL_OPTIONS"],
                )
                self.assertTrue(
                    (output_path.parent / "snap_auxdata").is_dir()
                )
                snap_output = Path(
                    next(value.split("=", 1)[1] for value in command if value.startswith("-Poutput="))
                )
                snap_output.write_bytes(b"mock DIMAP product")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            def fake_conversion(source, output, polarisations):
                self.assertTrue(source.is_file())
                self.assertEqual(polarisations, {"VV"})
                requested_crs = CRS.from_epsg(32645)
                with rasterio.open(
                    output,
                    "w",
                    driver="GTiff",
                    height=4,
                    width=4,
                    count=1,
                    dtype="float32",
                    crs=requested_crs,
                    transform=from_origin(500000, 2800000, 10, 10),
                ) as output:
                    output.write(
                        np.full((4, 4), -12.0, dtype="float32"),
                        1,
                    )

            with patch(
                "src.preprocessing.find_gpt_executable",
                return_value="gpt",
            ), patch(
                "src.preprocessing.subprocess.run",
                side_effect=fake_gpt,
            ) as run_gpt:
                with patch(
                    "src.preprocessing._convert_to_bigtiff",
                    side_effect=fake_conversion,
                ):
                    result = preprocess_sentinel1(archive_path, output_path)

            run_gpt.assert_called_once()
            self.assertEqual(result["output_crs"], "EPSG:32645")
            self.assertEqual(result["polarizations"], ["VV"])
            with rasterio.open(output_path) as output:
                self.assertEqual(output.descriptions, ("Sigma0_VV_dB",))
                self.assertEqual(output.tags()["PROCESSING_LEVEL"], "Sentinel-1 GRD Sigma0 dB")


if __name__ == "__main__":
    unittest.main()
