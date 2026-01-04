import os
import tempfile

from app.graph import build_expanded_graph
from app.gtfs import load_gtfs


def write_csv(path: str, header: str, rows: list) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\n")
        for row in rows:
            f.write(row + "\n")


def test_expanded_graph_transfer_edge() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        write_csv(
            os.path.join(tmp, "stops.txt"),
            "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
            [
                "X,Station X,28.0,77.0,1,",
                "Y,Station Y,28.1,77.1,1,",
            ],
        )
        write_csv(
            os.path.join(tmp, "routes.txt"),
            "route_id,route_short_name,route_long_name,route_color",
            ["L1,L1,Line 1,FF0000", "L2,L2,Line 2,00FF00"],
        )
        write_csv(
            os.path.join(tmp, "trips.txt"),
            "route_id,service_id,trip_id,shape_id",
            ["L1,WK,T1,", "L2,WK,T2,"],
        )
        write_csv(
            os.path.join(tmp, "stop_times.txt"),
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
            [
                "T1,08:00:00,08:00:00,X,1",
                "T1,08:05:00,08:05:00,Y,2",
                "T2,08:00:00,08:00:00,X,1",
                "T2,08:06:00,08:06:00,Y,2",
            ],
        )

        gtfs = load_gtfs(tmp)
        penalties = {"X": 5.0, "Y": 0.0}
        graph, station_to_lines = build_expanded_graph(gtfs, penalties, base_station_id="X")
        node_l1 = graph.node_to_id.get(("X", "L1"))
        node_l2 = graph.node_to_id.get(("X", "L2"))
        assert node_l1 is not None and node_l2 is not None
        outgoing = {dst: w for dst, w in graph.adj[node_l1]}
        assert outgoing.get(node_l2) == 5.0
