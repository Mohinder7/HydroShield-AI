import unittest

import numpy as np
from affine import Affine
from rasterio.crs import CRS

from src.pipeline import calculate_area


class CalculateAreaTests(unittest.TestCase):
    def test_pixel_area_uses_affine_determinant(self):
        mask = np.ones((4, 4), dtype=bool)
        profile = {
            "crs": CRS.from_epsg(32645),
            "transform": Affine(10, 2, 500000, 3, -10, 2800000),
        }

        self.assertAlmostEqual(calculate_area(mask, profile), 0.001696)

    def test_north_up_pixel_area_is_unchanged(self):
        mask = np.ones((4, 4), dtype=bool)
        profile = {
            "crs": CRS.from_epsg(32645),
            "transform": Affine(10, 0, 500000, 0, -10, 2800000),
        }

        self.assertAlmostEqual(calculate_area(mask, profile), 0.0016)


if __name__ == "__main__":
    unittest.main()
