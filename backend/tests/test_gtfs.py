import os
import tempfile

from app.gtfs import load_gtfs


def write_csv(path: str, header: str, rows: list) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\n")
        for row in rows:
            f.write(row + "\n")


def test_load_gtfs_basic() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        write_csv(
            os.path.join(tmp, "stops.txt"),
            "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
            [
                "A,Station A,28.0,77.0,1,",
                "B,Station B,28.1,77.1,1,",
            ],
        )
        write_csv(
            os.path.join(tmp, "routes.txt"),
            "route_id,route_short_name,route_long_name,route_color",
            ["L1,L1,Line 1,FF0000"],
        )
        write_csv(
            os.path.join(tmp, "trips.txt"),
            "route_id,service_id,trip_id,shape_id",
            ["L1,WK,T1,"],
        )
        write_csv(
            os.path.join(tmp, "stop_times.txt"),
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
            [
                "T1,08:00:00,08:00:00,A,1",
                "T1,08:05:00,08:05:00,B,2",
            ],
        )

        gtfs = load_gtfs(tmp)
        assert "A" in gtfs.stations
        assert "B" in gtfs.stations
        assert "L1" in gtfs.lines
        key = ("L1", "A", "B")
        assert key in gtfs.run_times
        assert gtfs.run_times[key] == 300.0
