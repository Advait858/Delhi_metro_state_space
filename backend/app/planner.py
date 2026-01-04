import logging
import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .graph import ExpandedGraph, build_expanded_graph, dijkstra, reconstruct_path
from .gtfs import GTFSData

logger = logging.getLogger(__name__)


@dataclass
class Route:
    stations: List[str]


@dataclass
class PlanResult:
    routes: List[Route]


def compute_inspection_times(
    gtfs: GTFSData,
    single_line_min: float,
    two_line_min: float,
    three_plus_min: float,
    overrides: Dict[str, float],
) -> Dict[str, float]:
    times: Dict[str, float] = {}
    for station_id, station in gtfs.stations.items():
        if station_id in overrides:
            times[station_id] = overrides[station_id]
            continue
        line_count = max(1, len(station.lines))
        if line_count == 1:
            times[station_id] = single_line_min
        elif line_count == 2:
            times[station_id] = two_line_min
        else:
            times[station_id] = three_plus_min
    return times


def compute_transfer_penalties(
    gtfs: GTFSData,
    two_line_min: float,
    three_plus_min: float,
    overrides: Dict[str, float],
) -> Dict[str, float]:
    penalties: Dict[str, float] = {}
    for station_id, station in gtfs.stations.items():
        if station_id in overrides:
            penalties[station_id] = overrides[station_id]
            continue
        line_count = len(station.lines)
        if line_count <= 1:
            penalties[station_id] = 0.0
        elif line_count == 2:
            penalties[station_id] = two_line_min
        else:
            step = max(0.0, three_plus_min - two_line_min)
            penalties[station_id] = two_line_min + (line_count - 2) * step
    return penalties


def compute_metric_closure(
    graph: ExpandedGraph,
    station_ids: List[str],
    station_to_lines: Dict[str, List[str]],
) -> Dict[Tuple[str, str], float]:
    closure: Dict[Tuple[str, str], float] = {}
    for origin in station_ids:
        sources = []
        for line_id in station_to_lines.get(origin, []):
            node_id = graph.node_to_id.get((origin, line_id))
            if node_id is not None:
                sources.append(node_id)
        if not sources:
            logger.warning("No line variants for station %s", origin)
            for dest in station_ids:
                closure[(origin, dest)] = float("inf")
            continue
        dist, _ = dijkstra(graph, sources)
        for dest in station_ids:
            best = float("inf")
            for line_id in station_to_lines.get(dest, []):
                node_id = graph.node_to_id.get((dest, line_id))
                if node_id is not None and node_id in dist:
                    if dist[node_id] < best:
                        best = dist[node_id]
            closure[(origin, dest)] = best
            if best == float("inf"):
                logger.warning(f"Unreachable: {origin} -> {dest}")
    return closure


def route_time(
    route: Route,
    base_id: str,
    closure: Dict[Tuple[str, str], float],
    inspection: Dict[str, float],
) -> Tuple[float, float, float]:
    travel = 0.0
    if route.stations:
        travel += closure.get((base_id, route.stations[0]), float("inf"))
        for i in range(len(route.stations) - 1):
            travel += closure.get((route.stations[i], route.stations[i + 1]), float("inf"))
        travel += closure.get((route.stations[-1], base_id), float("inf"))
    inspection_time = sum(inspection.get(s, 0.0) for s in route.stations)
    total = travel + inspection_time
    return travel, inspection_time, total


def best_insertion(
    route: Route,
    station_id: str,
    base_id: str,
    closure: Dict[Tuple[str, str], float],
    inspection: Dict[str, float],
    budget: float,
) -> Optional[Tuple[int, float]]:
    best_pos = None
    best_total = float("inf")
    for pos in range(len(route.stations) + 1):
        new_stations = route.stations[:pos] + [station_id] + route.stations[pos:]
        new_route = Route(new_stations)
        _, _, total = route_time(new_route, base_id, closure, inspection)
        if total <= budget and total < best_total:
            best_total = total
            best_pos = pos
    if best_pos is None:
        return None
    return best_pos, best_total


def construct_routes(
    station_ids: List[str],
    base_id: str,
    closure: Dict[Tuple[str, str], float],
    inspection: Dict[str, float],
    daily_budget: float,
) -> List[Route]:
    # Start with one day
    routes = [Route([])]
    distances = {s: closure.get((base_id, s), float("inf")) for s in station_ids}
    station_order = sorted(station_ids, key=lambda s: distances.get(s, float("inf")), reverse=True)

    for station_id in station_order:
        best_choice = None
        for r_idx, route in enumerate(routes):
            insertion = best_insertion(route, station_id, base_id, closure, inspection, daily_budget)
            if insertion is None:
                continue
            pos, total = insertion
            if best_choice is None or total < best_choice[2]:
                best_choice = (r_idx, pos, total)
        
        if best_choice is None:
            # Try creating a new day
            fresh_route = Route([station_id])
            _, _, required = route_time(fresh_route, base_id, closure, inspection)
            if required > daily_budget:
                logger.error(f"Station {station_id} requires {required:.2f} min > budget {daily_budget} - SKIPPING")
                continue
            
            # Append new route
            routes.append(fresh_route)
        else:
            r_idx, pos, _ = best_choice
            routes[r_idx].stations.insert(pos, station_id)

    return routes


def local_search(
    routes: List[Route],
    base_id: str,
    closure: Dict[Tuple[str, str], float],
    inspection: Dict[str, float],
    daily_budget: float,
    max_iter: int = 20,
) -> List[Route]:
    def total_time(routes_list: List[Route]) -> float:
        return sum(route_time(r, base_id, closure, inspection)[2] for r in routes_list)

    improved = True
    iterations = 0
    while improved and iterations < max_iter:
        improved = False
        iterations += 1
        current_total = total_time(routes)

        for i, route in enumerate(routes):
            for j, station_id in enumerate(list(route.stations)):
                for k in range(len(routes)):
                    if i == k and len(route.stations) <= 1:
                        continue
                    candidate_routes = [Route(r.stations.copy()) for r in routes]
                    candidate_routes[i].stations.pop(j)
                    insert_pos = best_insertion(
                        candidate_routes[k], station_id, base_id, closure, inspection, daily_budget
                    )
                    if insert_pos is None:
                        continue
                    pos, _ = insert_pos
                    candidate_routes[k].stations.insert(pos, station_id)
                    if all(
                        route_time(r, base_id, closure, inspection)[2] <= daily_budget
                        for r in candidate_routes
                    ):
                        new_total = total_time(candidate_routes)
                        if new_total + 1e-6 < current_total:
                            routes = candidate_routes
                            improved = True
                            break
                if improved:
                    break
            if improved:
                break

        if improved:
            continue

        for i in range(len(routes)):
            for j in range(i + 1, len(routes)):
                for a_idx, a_station in enumerate(routes[i].stations):
                    for b_idx, b_station in enumerate(routes[j].stations):
                        candidate_routes = [Route(r.stations.copy()) for r in routes]
                        candidate_routes[i].stations[a_idx] = b_station
                        candidate_routes[j].stations[b_idx] = a_station
                        if all(
                            route_time(r, base_id, closure, inspection)[2] <= daily_budget
                            for r in candidate_routes
                        ):
                            new_total = total_time(candidate_routes)
                            if new_total + 1e-6 < current_total:
                                routes = candidate_routes
                                improved = True
                                break
                    if improved:
                        break
                if improved:
                    break
            if improved:
                break

        if improved:
            continue

        for i, route in enumerate(routes):
            if len(route.stations) < 4:
                continue
            for a in range(0, len(route.stations) - 2):
                for b in range(a + 2, len(route.stations)):
                    candidate = Route(
                        route.stations[:a] + list(reversed(route.stations[a:b])) + route.stations[b:]
                    )
                    travel, insp, total = route_time(candidate, base_id, closure, inspection)
                    if total <= daily_budget:
                        current_total = total_time(routes)
                        candidate_routes = [Route(r.stations.copy()) for r in routes]
                        candidate_routes[i] = candidate
                        new_total = total_time(candidate_routes)
                        if new_total + 1e-6 < current_total:
                            routes = candidate_routes
                            improved = True
                            break
                if improved:
                    break
            if improved:
                break

    return routes


def build_plan(
    gtfs: GTFSData,
    start_station_id: str,
    daily_budget: float,
    inspection_single: float,
    inspection_two_line: float,
    inspection_three_plus: float,
    inspection_overrides: Dict[str, float],
    transfer_two: float,
    transfer_three: float,
    transfer_overrides: Dict[str, float],
    base_inspection: bool,
    max_days: Optional[int] = None,
) -> Tuple[
    List[Route],
    ExpandedGraph,
    Dict[str, List[str]],
    Dict[Tuple[str, str], float],
    Dict[str, float],
    float,
]:
    inspection_times = compute_inspection_times(
        gtfs, inspection_single, inspection_two_line, inspection_three_plus, inspection_overrides
    )
    transfer_penalties = compute_transfer_penalties(gtfs, transfer_two, transfer_three, transfer_overrides)

    graph, station_to_lines = build_expanded_graph(
        gtfs, transfer_penalties, base_station_id=start_station_id
    )

    station_ids = list(gtfs.stations.keys())
    closure = compute_metric_closure(graph, station_ids, station_to_lines)

    base_inspection_minutes = 0.0
    if start_station_id in station_ids:
        station_ids.remove(start_station_id)
    if base_inspection:
        base_inspection_minutes = inspection_times.get(start_station_id, 0.0)

    if not station_ids:
        return [Route([])], graph, station_to_lines, closure, inspection_times, base_inspection_minutes

    total_inspection = sum(inspection_times.get(s, 0.0) for s in station_ids)
    
    # Construct initial solution (dynamic days)
    routes = construct_routes(station_ids, start_station_id, closure, inspection_times, daily_budget)
    
    # Run local search optimization
    routes = local_search(routes, start_station_id, closure, inspection_times, daily_budget)
    
    if max_days and len(routes) > max_days:
        logger.warning(f"Plan requires {len(routes)} days, exceeding limit {max_days}")
    
    return routes, graph, station_to_lines, closure, inspection_times, base_inspection_minutes


def expanded_path_between(
    graph: ExpandedGraph,
    station_to_lines: Dict[str, List[str]],
    start_station: str,
    end_station: str,
    start_from_depot: bool,
) -> Tuple[List[int], float]:
    sources = []
    if start_from_depot:
        depot_id = graph.node_to_id.get((start_station, None))
        if depot_id is not None:
            sources = [depot_id]
    if not sources:
        for line_id in station_to_lines.get(start_station, []):
            node_id = graph.node_to_id.get((start_station, line_id))
            if node_id is not None:
                sources.append(node_id)
    target_ids = set()
    for line_id in station_to_lines.get(end_station, []):
        node_id = graph.node_to_id.get((end_station, line_id))
        if node_id is not None:
            target_ids.add(node_id)
    if not sources or not target_ids:
        return [], float("inf")
    dist, prev = dijkstra(graph, sources, targets=target_ids, return_prev=True)
    best_target = min(target_ids, key=lambda tid: dist.get(tid, float("inf")))
    if best_target not in dist:
        return [], float("inf")
    path = reconstruct_path(prev, best_target)
    return path, dist[best_target]
