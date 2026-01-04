import csv
import logging
from typing import Dict, Iterable, List, Tuple


def parse_gtfs_time_to_seconds(value: str) -> int:
    if value is None or value == "":
        raise ValueError("empty time value")
    parts = value.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"invalid time format: {value}")
    hours, minutes, seconds = (int(p) for p in parts)
    return hours * 3600 + minutes * 60 + seconds


def median(values: List[int]) -> float:
    if not values:
        raise ValueError("median of empty list")
    values_sorted = sorted(values)
    mid = len(values_sorted) // 2
    if len(values_sorted) % 2 == 1:
        return float(values_sorted[mid])
    return (values_sorted[mid - 1] + values_sorted[mid]) / 2.0


def read_csv(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [row for row in reader]


def warn_missing(logger: logging.Logger, items: Iterable[Tuple[str, str]]) -> None:
    for key, message in items:
        logger.warning("%s: %s", key, message)
