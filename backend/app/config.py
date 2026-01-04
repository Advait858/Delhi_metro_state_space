import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AppConfig:
    gtfs_path: str
    default_inspection_single_min: float
    default_inspection_two_line_min: float
    default_inspection_three_plus_min: float
    default_transfer_two_line_min: float
    default_transfer_three_plus_min: float
    base_inspection_enabled: bool


def load_config() -> AppConfig:
    gtfs_path = os.getenv("GTFS_PATH", os.path.join("..", "data", "gtfs"))
    return AppConfig(
        gtfs_path=gtfs_path,
        default_inspection_single_min=4.0,
        default_inspection_two_line_min=7.0,
        default_inspection_three_plus_min=10.0,
        default_transfer_two_line_min=4.0,
        default_transfer_three_plus_min=6.0,
        base_inspection_enabled=False,
    )
