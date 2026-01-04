from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class StationOut(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    lines: List[str]


class LineOut(BaseModel):
    id: str
    name: str
    color: Optional[str] = None
    polyline: List[List[float]] = Field(default_factory=list)


class InspectionModel(BaseModel):
    single_line_minutes: float = 4.0
    two_line_minutes: float = 7.0
    three_plus_minutes: float = 10.0
    overrides: Dict[str, float] = Field(default_factory=dict)


class TransferModel(BaseModel):
    two_line_minutes: float = 4.0
    three_plus_minutes: float = 6.0
    overrides: Dict[str, float] = Field(default_factory=dict)


class PlanRequest(BaseModel):
    start_station_id: str
    daily_budget_minutes: float
    inspection: InspectionModel = InspectionModel()
    transfer: TransferModel = TransferModel()
    base_inspection: bool = False
    max_days: Optional[int] = None


class PathSegment(BaseModel):
    from_station_id: str
    to_station_id: str
    minutes: float
    coords: List[List[float]] = Field(default_factory=list)
    transfer_count: int = 0


class DayPlan(BaseModel):
    day_index: int
    stations: List[str]
    travel_minutes: float
    inspection_minutes: float
    total_minutes: float
    transfer_count: int
    segments: List[PathSegment]


class PlanStats(BaseModel):
    total_days: int
    total_minutes: float
    total_travel_minutes: float
    total_inspection_minutes: float
    total_transfer_count: int


class PlanResponse(BaseModel):
    days: List[DayPlan]
    stats: PlanStats
