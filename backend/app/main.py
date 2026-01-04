import logging
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import load_config
from .gtfs import GTFSData, load_gtfs
from .models import DayPlan, LineOut, PathSegment, PlanRequest, PlanResponse, PlanStats, StationOut
from .planner import build_plan, expanded_path_between, route_time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Delhi Metro Auditor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    config = load_config()
    try:
        gtfs = load_gtfs(config.gtfs_path)
    except Exception as exc:
        logger.error("Failed to load GTFS: %s", exc)
        raise
    app.state.gtfs = gtfs
    app.state.config = config


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/stations", response_model=List[StationOut])
def stations() -> List[StationOut]:
    gtfs: GTFSData = app.state.gtfs
    return [
        StationOut(
            id=s.id,
            name=s.name,
            lat=s.lat,
            lon=s.lon,
            lines=s.lines,
        )
        for s in gtfs.stations.values()
    ]


@app.get("/lines", response_model=List[LineOut])
def lines() -> List[LineOut]:
    gtfs: GTFSData = app.state.gtfs
    return [
        LineOut(
            id=l.id,
            name=l.name,
            color=l.color,
            polyline=l.polyline,
        )
        for l in gtfs.lines.values()
    ]


@app.post("/plan", response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse:
    gtfs: GTFSData = app.state.gtfs

    if request.start_station_id not in gtfs.stations:
        raise HTTPException(status_code=400, detail="Unknown start station")

    try:
        routes, graph, station_to_lines, closure, inspection_times, base_inspection_minutes = build_plan(
            gtfs=gtfs,
            start_station_id=request.start_station_id,
            daily_budget=request.daily_budget_minutes,
            inspection_single=request.inspection.single_line_minutes,
            inspection_two_line=request.inspection.two_line_minutes,
            inspection_three_plus=request.inspection.three_plus_minutes,
            inspection_overrides=request.inspection.overrides,
            transfer_two=request.transfer.two_line_minutes,
            transfer_three=request.transfer.three_plus_minutes,
            transfer_overrides=request.transfer.overrides,
            base_inspection=request.base_inspection,
            max_days=request.max_days,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    days: List[DayPlan] = []
    total_travel = 0.0
    total_insp = 0.0
    total_transfers = 0

    for idx, route in enumerate(routes):
        travel, inspection, total = route_time(
            route, request.start_station_id, closure, inspection_times
        )
        segments: List[PathSegment] = []
        transfer_count = 0

        if route.stations:
            path_stations = [request.start_station_id] + route.stations + [request.start_station_id]
            for hop_idx in range(len(path_stations) - 1):
                start_station = path_stations[hop_idx]
                end_station = path_stations[hop_idx + 1]
                start_from_depot = hop_idx == 0
                path, minutes = expanded_path_between(
                    graph, station_to_lines, start_station, end_station, start_from_depot
                )
                coords = []
                seg_transfers = 0
                last_station = None
                last_line = None
                for node_id in path:
                    node = graph.id_to_node[node_id]
                    station = gtfs.stations.get(node.station_id)
                    if station:
                        coords.append([station.lat, station.lon])
                    if last_station == node.station_id and last_line and node.line_id and last_line != node.line_id:
                        seg_transfers += 1
                    last_station = node.station_id
                    last_line = node.line_id
                transfer_count += seg_transfers
                segments.append(
                    PathSegment(
                        from_station_id=start_station,
                        to_station_id=end_station,
                        minutes=minutes,
                        coords=coords,
                        transfer_count=seg_transfers,
                    )
                )

        if idx == 0 and base_inspection_minutes > 0:
            inspection += base_inspection_minutes
            total += base_inspection_minutes
        total_travel += travel
        total_insp += inspection
        total_transfers += transfer_count
        days.append(
            DayPlan(
                day_index=idx + 1,
                stations=route.stations,
                travel_minutes=travel,
                inspection_minutes=inspection,
                total_minutes=total,
                transfer_count=transfer_count,
                segments=segments,
            )
        )

    stats = PlanStats(
        total_days=len(days),
        total_minutes=total_travel + total_insp,
        total_travel_minutes=total_travel,
        total_inspection_minutes=total_insp,
        total_transfer_count=total_transfers,
    )
    return PlanResponse(days=days, stats=stats)
