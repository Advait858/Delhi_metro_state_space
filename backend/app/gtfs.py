import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .utils import median, parse_gtfs_time_to_seconds, read_csv

logger = logging.getLogger(__name__)


@dataclass
class Station:
    id: str
    name: str
    lat: float
    lon: float
    lines: List[str]


@dataclass
class Line:
    id: str
    name: str
    color: Optional[str]
    polyline: List[List[float]]


@dataclass
class GTFSData:
    stations: Dict[str, Station]
    lines: Dict[str, Line]
    run_times: Dict[Tuple[str, str, str], float]
    run_times: Dict[Tuple[str, str, str], float]
    line_sequences: Dict[str, List[str]]
    transfers: List[Dict[str, str]]


def _find_file(gtfs_path: str, filename: str) -> Optional[str]:
    candidate = os.path.join(gtfs_path, filename)
    if os.path.exists(candidate):
        return candidate
    return None


def load_gtfs(gtfs_path: str) -> GTFSData:
    stops_path = _find_file(gtfs_path, "stops.txt")
    routes_path = _find_file(gtfs_path, "routes.txt")
    trips_path = _find_file(gtfs_path, "trips.txt")
    stop_times_path = _find_file(gtfs_path, "stop_times.txt")
    shapes_path = _find_file(gtfs_path, "shapes.txt")

    missing = []
    for required, path in [
        ("stops.txt", stops_path),
        ("routes.txt", routes_path),
        ("trips.txt", trips_path),
        ("stop_times.txt", stop_times_path),
    ]:
        if path is None:
            missing.append((required, "file missing"))
    if missing:
        raise FileNotFoundError(f"Missing GTFS files: {', '.join([m[0] for m in missing])}")

    stops = read_csv(stops_path)
    routes = read_csv(routes_path)
    trips = read_csv(trips_path)
    stop_times = read_csv(stop_times_path)
    
    transfers_path = _find_file(gtfs_path, "transfers.txt")
    transfers = []
    if transfers_path:
        transfers = read_csv(transfers_path)

    station_rows: Dict[str, List[Dict[str, str]]] = {}
    station_name: Dict[str, str] = {}
    station_latlon: Dict[str, Tuple[float, float]] = {}

    stop_to_station: Dict[str, str] = {}
    for row in stops:
        stop_id = row.get("stop_id", "")
        parent = row.get("parent_station", "")
        location_type = row.get("location_type", "")
        station_id = parent if parent else stop_id
        stop_to_station[stop_id] = station_id
        station_rows.setdefault(station_id, []).append(row)
        if location_type == "1" or (not parent and location_type == ""):
            station_name[station_id] = row.get("stop_name", stop_id)
            try:
                station_latlon[station_id] = (
                    float(row.get("stop_lat", "0") or 0),
                    float(row.get("stop_lon", "0") or 0),
                )
            except ValueError:
                logger.warning("Invalid lat/lon for station %s", station_id)

    stations: Dict[str, Station] = {}
    for station_id, rows in station_rows.items():
        name = station_name.get(station_id, rows[0].get("stop_name", station_id))
        if station_id in station_latlon:
            lat, lon = station_latlon[station_id]
        else:
            lats = []
            lons = []
            for row in rows:
                try:
                    lats.append(float(row.get("stop_lat", "0") or 0))
                    lons.append(float(row.get("stop_lon", "0") or 0))
                except ValueError:
                    continue
            if lats:
                lat = sum(lats) / len(lats)
                lon = sum(lons) / len(lons)
            else:
                logger.warning("Missing lat/lon for station %s", station_id)
                lat = 0.0
                lon = 0.0
        stations[station_id] = Station(
            id=station_id,
            name=name,
            lat=lat,
            lon=lon,
            lines=[],
        )

    # Hardcoded color map for Delhi Metro
    # Official or approximate hex codes
    COLOR_MAP = {
        "RED": "FF0000",
        "YELLOW": "FFE100",
        "BLUE": "0055A4",
        "GREEN": "008000",
        "VIOLET": "4B0082",
        "MAGENTA": "FF00FF",
        "PINK": "FF69B4",
        "ORANGE": "FFA500",
        "AIRPORT": "FFA500",
        "AQUA": "00FFFF",
        "GRAY": "808080",
        "RAPID": "191970",  # Midnight Blue for Rapid
    }

    routes_by_id: Dict[str, Tuple[str, Optional[str]]] = {}
    for row in routes:
        route_id = row.get("route_id", "")
        long_name = row.get("route_long_name", "").upper()
        short_name = row.get("route_short_name", "").upper()
        name = row.get("route_short_name") or row.get("route_long_name") or route_id
        
        # Try to find color in long_name (e.g., "RED_...")
        color = row.get("route_color")
        if not color:
            for key, hex_code in COLOR_MAP.items():
                if key in long_name or key in short_name:
                    color = hex_code
                    break
        
        # Fallback default if still no color
        if not color:
            color = "000000"

        routes_by_id[route_id] = (name, color)

    trip_to_route: Dict[str, str] = {}
    trip_to_shape: Dict[str, Optional[str]] = {}
    for row in trips:
        trip_id = row.get("trip_id", "")
        route_id = row.get("route_id", "")
        trip_to_route[trip_id] = route_id
        trip_to_shape[trip_id] = row.get("shape_id") or None

    stop_times_by_trip: Dict[str, List[Dict[str, str]]] = {}
    for row in stop_times:
        trip_id = row.get("trip_id", "")
        stop_times_by_trip.setdefault(trip_id, []).append(row)

    run_time_samples: Dict[Tuple[str, str, str], List[int]] = {}
    line_sequences: Dict[str, List[str]] = {}
    line_station_sets: Dict[str, set] = {}

    for trip_id, rows in stop_times_by_trip.items():
        route_id = trip_to_route.get(trip_id)
        if not route_id:
            continue
        sorted_rows = sorted(rows, key=lambda r: int(r.get("stop_sequence", "0") or 0))
        station_seq: List[str] = []
        for r in sorted_rows:
            stop_id = r.get("stop_id", "")
            station_id = stop_to_station.get(stop_id, stop_id)
            station_seq.append(station_id)

        unique_seq = [s for i, s in enumerate(station_seq) if i == 0 or s != station_seq[i - 1]]
        if route_id not in line_sequences or len(unique_seq) > len(line_sequences[route_id]):
            line_sequences[route_id] = unique_seq

        for idx in range(len(sorted_rows) - 1):
            current = sorted_rows[idx]
            nxt = sorted_rows[idx + 1]
            stop_id = current.get("stop_id", "")
            next_stop_id = nxt.get("stop_id", "")

            s_from = stop_to_station.get(stop_id, stop_id)
            s_to = stop_to_station.get(next_stop_id, next_stop_id)
            try:
                depart = parse_gtfs_time_to_seconds(current.get("departure_time", ""))
                arrive = parse_gtfs_time_to_seconds(nxt.get("arrival_time", ""))
            except ValueError:
                continue
            dt = arrive - depart
            if dt <= 0:
                continue
            key = (route_id, s_from, s_to)
            run_time_samples.setdefault(key, []).append(dt)
            line_station_sets.setdefault(route_id, set()).update([s_from, s_to])

    run_times: Dict[Tuple[str, str, str], float] = {}
    for key, samples in run_time_samples.items():
        try:
            run_times[key] = median(samples)
        except ValueError:
            continue

    shapes: Dict[str, List[List[float]]] = {}
    if shapes_path:
        shapes_rows = read_csv(shapes_path)
        shapes_by_id: Dict[str, List[Tuple[int, float, float]]] = {}
        for row in shapes_rows:
            shape_id = row.get("shape_id", "")
            try:
                seq = int(row.get("shape_pt_sequence", "0") or 0)
                lat = float(row.get("shape_pt_lat", "0") or 0)
                lon = float(row.get("shape_pt_lon", "0") or 0)
            except ValueError:
                continue
            shapes_by_id.setdefault(shape_id, []).append((seq, lat, lon))
        shapes_by_id = {
            sid: sorted(points, key=lambda p: p[0]) for sid, points in shapes_by_id.items()
        }
        route_shape_counts: Dict[str, Dict[str, int]] = {}
        for trip_id, shape_id in trip_to_shape.items():
            if not shape_id:
                continue
            route_id = trip_to_route.get(trip_id, "")
            if not route_id:
                continue
            route_shape_counts.setdefault(route_id, {})
            route_shape_counts[route_id][shape_id] = route_shape_counts[route_id].get(shape_id, 0) + 1
        for route_id, counts in route_shape_counts.items():
            shape_id = max(counts.items(), key=lambda item: item[1])[0]
            points = shapes_by_id.get(shape_id, [])
            shapes[route_id] = [[p[1], p[2]] for p in points]

    lines: Dict[str, Line] = {}
    for route_id, (name, color) in routes_by_id.items():
        polyline = shapes.get(route_id, [])
        if not polyline and route_id in line_sequences:
            polyline = [[stations[s].lat, stations[s].lon] for s in line_sequences[route_id] if s in stations]
        lines[route_id] = Line(id=route_id, name=name, color=color, polyline=polyline)

    for route_id, station_set in line_station_sets.items():
        for s in station_set:
            if s in stations:
                stations[s].lines.append(route_id)

    for station_id, station in stations.items():
        if not station.lines:
            logger.warning("Station %s has no line assignments", station_id)

    return GTFSData(
        stations=stations, 
        lines=lines, 
        run_times=run_times, 
        line_sequences=line_sequences,
        transfers=transfers
    )
