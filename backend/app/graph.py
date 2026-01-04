import heapq
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from .gtfs import GTFSData


@dataclass
class Node:
    station_id: str
    line_id: Optional[str]


class ExpandedGraph:
    def __init__(self) -> None:
        self.node_to_id: Dict[Tuple[str, Optional[str]], int] = {}
        self.id_to_node: List[Node] = []
        self.adj: Dict[int, List[Tuple[int, float]]] = {}

    def add_node(self, station_id: str, line_id: Optional[str]) -> int:
        key = (station_id, line_id)
        if key in self.node_to_id:
            return self.node_to_id[key]
        node_id = len(self.id_to_node)
        self.node_to_id[key] = node_id
        self.id_to_node.append(Node(station_id=station_id, line_id=line_id))
        self.adj[node_id] = []
        return node_id

    def add_edge(self, src: int, dst: int, weight_min: float) -> None:
        self.adj[src].append((dst, weight_min))


def build_expanded_graph(
    gtfs: GTFSData,
    transfer_penalties_min: Dict[str, float],
    base_station_id: Optional[str] = None,
) -> Tuple[ExpandedGraph, Dict[str, List[str]]]:
    graph = ExpandedGraph()
    station_to_lines: Dict[str, List[str]] = {}

    for station_id, station in gtfs.stations.items():
        station_to_lines[station_id] = list(station.lines)
        for line_id in station.lines:
            graph.add_node(station_id, line_id)

    for (line_id, s_from, s_to), seconds in gtfs.run_times.items():
        if s_from not in station_to_lines or s_to not in station_to_lines:
            continue
        if line_id not in station_to_lines.get(s_from, []) or line_id not in station_to_lines.get(s_to, []):
            continue
        src = graph.add_node(s_from, line_id)
        dst = graph.add_node(s_to, line_id)
        graph.add_edge(src, dst, seconds / 60.0)

    for station_id, lines in station_to_lines.items():
        if len(lines) < 2:
            continue
        penalty = transfer_penalties_min.get(station_id, 0.0)
        for i in range(len(lines)):
            for j in range(len(lines)):
                if i == j:
                    continue
                src = graph.add_node(station_id, lines[i])
                dst = graph.add_node(station_id, lines[j])
                graph.add_edge(src, dst, penalty)

    # Process transfers from GTFS file
    for row in gtfs.transfers:
        s1 = row.get("from_stop_id")
        s2 = row.get("to_stop_id")
        try:
            time_sec = float(row.get("min_transfer_time", "0"))
        except ValueError:
            time_sec = 0.0
            
        # We assume s1 and s2 are station IDs (or mapped to them if we had that map exposed, 
        # but for now we rely on them matching station keys)
        if s1 in station_to_lines and s2 in station_to_lines:
            penalty = time_sec / 60.0
            
            # Link all lines of s1 to all lines of s2
            lines1 = station_to_lines.get(s1, [])
            lines2 = station_to_lines.get(s2, [])
            for l1 in lines1:
                for l2 in lines2:
                    n1 = graph.add_node(s1, l1)
                    n2 = graph.add_node(s2, l2)
                    graph.add_edge(n1, n2, penalty)

    if base_station_id:
        depot_id = graph.add_node(base_station_id, None)
        for line_id in station_to_lines.get(base_station_id, []):
            node_id = graph.add_node(base_station_id, line_id)
            graph.add_edge(depot_id, node_id, 0.0)
            graph.add_edge(node_id, depot_id, 0.0)

    return graph, station_to_lines


def dijkstra(
    graph: ExpandedGraph,
    sources: Iterable[int],
    targets: Optional[set] = None,
    return_prev: bool = False,
) -> Tuple[Dict[int, float], Dict[int, Optional[int]]]:
    dist: Dict[int, float] = {}
    prev: Dict[int, Optional[int]] = {}
    heap: List[Tuple[float, int]] = []
    for src in sources:
        dist[src] = 0.0
        prev[src] = None
        heapq.heappush(heap, (0.0, src))

    target_set = targets if targets is not None else None
    visited = set()

    while heap:
        d, u = heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)
        if target_set and u in target_set:
            break
        for v, w in graph.adj.get(u, []):
            nd = d + w
            if v not in dist or nd < dist[v]:
                dist[v] = nd
                if return_prev:
                    prev[v] = u
                heapq.heappush(heap, (nd, v))

    return dist, prev


def reconstruct_path(prev: Dict[int, Optional[int]], target: int) -> List[int]:
    path = []
    cur = target
    while cur is not None:
        path.append(cur)
        cur = prev.get(cur)
    return list(reversed(path))
