"""
Tests for src/model_service.py

Covers:
  - Model artifact loading and feature-count validation
  - NaN / nodata pixel exclusion
  - Full tiled inference on a synthetic 6-band GeoTIFF
  - Output GeoTIFF: correct CRS, transform, dtype, nodata
  - NaN input rows produce nodata in output
  - Valid output pixels are strictly 0 or 1
  - get_model_status() structure
  - predict_flood_candidates() raises FileNotFoundError when raster missing
"""

import sys
import tempfile
import unittest
import warnings
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS

warnings.filterwarnings("ignore")

# Make sure the backend root is on sys.path
_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from src.model_service import (
    N_FEATURES,
    NODATA_OUT,
    _predict_chunk,
    _state,
    ensure_loaded,
    get_model_status,
    predict_flood_candidates,
    run_inference,
)


class TestModelLoading(unittest.TestCase):

    def setUp(self):
        ensure_loaded()

    def test_model_loads_and_is_ready(self):
        self.assertTrue(_state.ready, f"Model not ready: {_state.error}")

    def test_model_feature_count(self):
        self.assertEqual(_state.model.n_features_in_, N_FEATURES)

    def test_scaler_feature_count(self):
        self.assertEqual(_state.scaler.n_features_in_, N_FEATURES)

    def test_model_classes(self):
        self.assertEqual(list(_state.model.classes_), [0, 1])

    def test_meta_feature_names(self):
        from src.model_service import FEATURE_NAMES
        self.assertEqual(
            _state.meta.get("feature_names"),
            FEATURE_NAMES,
        )

    def test_meta_has_label_warning(self):
        self.assertIn("label_warning", _state.meta)
        self.assertIn("candidate", _state.meta["label_warning"].lower())


class TestNaNHandling(unittest.TestCase):

    def setUp(self):
        ensure_loaded()

    def test_nan_rows_excluded_from_inference(self):
        rng = np.random.default_rng(0)
        H, W = 16, 16
        tile = rng.uniform(-20, -5, (H, W, N_FEATURES)).astype("float32")
        tile[0, :, :] = np.nan       # entire row NaN
        tile[8, 8, 2] = np.nan       # single-feature NaN

        pixels = tile.reshape(-1, N_FEATURES)
        valid_mask = np.isfinite(pixels).all(axis=1)
        valid_pixels = pixels[valid_mask]

        # No NaN must survive the filter
        self.assertFalse(np.any(np.isnan(valid_pixels)))

        preds = _predict_chunk(_state.model, _state.scaler, valid_pixels)
        self.assertEqual(preds.dtype, np.dtype("uint8"))
        self.assertTrue(set(np.unique(preds)).issubset({0, 1}))
        self.assertLess(valid_mask.sum(), H * W,
                        "NaN pixels should have been excluded")

    def test_all_nan_tile_produces_no_predictions(self):
        all_nan = np.full((10, N_FEATURES), np.nan, dtype="float32")
        valid_mask = np.isfinite(all_nan).all(axis=1)
        self.assertEqual(valid_mask.sum(), 0)


class TestTiledInference(unittest.TestCase):
    """Write a synthetic 6-band GeoTIFF and run full inference on it."""

    def setUp(self):
        ensure_loaded()
        rng = np.random.default_rng(42)
        self.H, self.W = 64, 80
        data = rng.uniform(-20, -5, (N_FEATURES, self.H, self.W)).astype("float32")
        # Introduce nodata rows
        data[:, :4, :] = np.nan

        transform = Affine(10.0, 0, 500000, 0, -10.0, 2800000)
        crs = CRS.from_epsg(32645)

        # Use NamedTemporaryFile with delete=False and close immediately
        # so rasterio can open/close freely on Windows.
        import tempfile as _tf
        fd1, feat_name = _tf.mkstemp(suffix=".tif")
        fd2, out_name  = _tf.mkstemp(suffix=".tif")
        import os as _os
        _os.close(fd1)
        _os.close(fd2)

        feat_path = Path(feat_name)
        self._out_path = Path(out_name)

        profile = dict(
            driver="GTiff", dtype="float32", count=N_FEATURES,
            height=self.H, width=self.W, crs=crs, transform=transform,
        )
        with rasterio.open(feat_path, "w", **profile) as dst:
            dst.write(data)

        self._feat_path = feat_path
        self._transform = transform
        self._crs = crs

    def tearDown(self):
        import gc
        gc.collect()   # release any rasterio handles before unlinking
        self._feat_path.unlink(missing_ok=True)
        self._out_path.unlink(missing_ok=True)

    def _run(self, tile_rows=16):
        return run_inference(self._feat_path, self._out_path, tile_rows=tile_rows)

    def test_result_keys_present(self):
        result = self._run()
        for key in ("candidate_pixels", "valid_pixels", "candidate_percentage", "output_filename"):
            self.assertIn(key, result)

    def test_valid_pixel_count_reasonable(self):
        result = self._run()
        self.assertGreater(result["valid_pixels"], 0)
        self.assertLessEqual(result["valid_pixels"], self.H * self.W)

    def test_candidate_percentage_in_range(self):
        result = self._run()
        self.assertGreaterEqual(result["candidate_percentage"], 0.0)
        self.assertLessEqual(result["candidate_percentage"], 100.0)

    def test_output_geotiff_crs_preserved(self):
        self._run()
        with rasterio.open(self._out_path) as dst:
            self.assertEqual(dst.crs, self._crs)

    def test_output_geotiff_transform_preserved(self):
        self._run()
        with rasterio.open(self._out_path) as dst:
            self.assertEqual(dst.transform, self._transform)

    def test_output_geotiff_dtype_uint8(self):
        self._run()
        with rasterio.open(self._out_path) as dst:
            self.assertEqual(dst.dtypes[0], "uint8")

    def test_output_geotiff_nodata_correct(self):
        self._run()
        with rasterio.open(self._out_path) as dst:
            self.assertEqual(dst.nodata, NODATA_OUT)

    def test_nan_rows_become_nodata_in_output(self):
        self._run()
        with rasterio.open(self._out_path) as dst:
            arr = dst.read(1)
            # First 4 rows were all NaN → must all be nodata
            nan_rows = arr[:4, :]
            self.assertTrue(
                (nan_rows == NODATA_OUT).all(),
                "NaN input rows should produce nodata pixels in output",
            )

    def test_valid_output_pixels_are_0_or_1(self):
        self._run()
        with rasterio.open(self._out_path) as dst:
            arr = dst.read(1)
            valid_out = arr[arr != NODATA_OUT]
            self.assertTrue(
                set(np.unique(valid_out)).issubset({0, 1}),
                "Valid output pixels must be 0 or 1",
            )

    def test_tiling_produces_same_result(self):
        """Inference with tile_rows=16 and tile_rows=64 should match."""
        res16 = run_inference(self._feat_path, self._out_path, tile_rows=16)
        # Overwrite with larger tile
        res64 = run_inference(self._feat_path, self._out_path, tile_rows=64)
        self.assertEqual(res16["valid_pixels"],     res64["valid_pixels"])
        self.assertEqual(res16["candidate_pixels"], res64["candidate_pixels"])

    def test_wrong_band_count_raises(self):
        """A 3-band raster should raise ValueError."""
        import os as _os, gc, tempfile as _tf
        fd, bad_name = _tf.mkstemp(suffix=".tif")
        _os.close(fd)
        bad_path = Path(bad_name)
        profile = dict(
            driver="GTiff", dtype="float32", count=3,
            height=16, width=16, crs=self._crs, transform=self._transform,
        )
        with rasterio.open(bad_path, "w", **profile) as dst:
            dst.write(np.ones((3, 16, 16), dtype="float32"))
        try:
            with self.assertRaises(ValueError):
                run_inference(bad_path, self._out_path)
        finally:
            gc.collect()
            bad_path.unlink(missing_ok=True)


class TestModelStatus(unittest.TestCase):

    def setUp(self):
        ensure_loaded()

    def test_status_has_required_keys(self):
        status = get_model_status()
        required = [
            "model_ready", "model_error", "model_path", "scaler_path",
            "model_exists", "scaler_exists", "model_version",
            "feature_names", "n_features", "label_warning",
            "feature_raster_found", "output_dir",
        ]
        for key in required:
            self.assertIn(key, status, f"Missing key: {key}")

    def test_model_ready_true(self):
        self.assertTrue(get_model_status()["model_ready"])

    def test_feature_names_correct(self):
        from src.model_service import FEATURE_NAMES
        self.assertEqual(get_model_status()["feature_names"], FEATURE_NAMES)

    def test_n_features_is_6(self):
        self.assertEqual(get_model_status()["n_features"], 6)

    def test_label_warning_present(self):
        warning = get_model_status()["label_warning"]
        self.assertTrue(len(warning) > 20)

    def test_feature_raster_not_found_reflected(self):
        # The GEE raster doesn't exist locally; status should reflect that
        status = get_model_status()
        # Just ensure the key is boolean — actual value depends on environment
        self.assertIsInstance(status["feature_raster_found"], bool)


class TestPredictFloodCandidates(unittest.TestCase):

    def test_raises_file_not_found_when_raster_missing(self):
        """predict_flood_candidates() must raise FileNotFoundError
        when no GEE feature raster is available (expected in CI)."""
        import os
        # Temporarily clear the env var if set
        orig = os.environ.pop("HYDROSHIELD_FEATURE_RASTER", None)
        try:
            with self.assertRaises(FileNotFoundError):
                predict_flood_candidates()
        finally:
            if orig is not None:
                os.environ["HYDROSHIELD_FEATURE_RASTER"] = orig


if __name__ == "__main__":
    unittest.main(verbosity=2)
