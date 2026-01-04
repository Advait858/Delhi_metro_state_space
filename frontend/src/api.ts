export type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
};

export type Line = {
  id: string;
  name: string;
  color?: string | null;
  polyline: number[][];
};

export type PlanRequest = {
  start_station_id: string;
  daily_budget_minutes: number;
  inspection: {
    single_line_minutes: number;
    two_line_minutes: number;
    three_plus_minutes: number;
    overrides: Record<string, number>;
  };
  transfer: {
    two_line_minutes: number;
    three_plus_minutes: number;
    overrides: Record<string, number>;
  };
  base_inspection: boolean;
  max_days?: number;
};

export type PathSegment = {
  from_station_id: string;
  to_station_id: string;
  minutes: number;
  coords: number[][];
  transfer_count: number;
};

export type DayPlan = {
  day_index: number;
  stations: string[];
  travel_minutes: number;
  inspection_minutes: number;
  total_minutes: number;
  transfer_count: number;
  segments: PathSegment[];
};

export type PlanResponse = {
  days: DayPlan[];
  stats: {
    total_days: number;
    total_minutes: number;
    total_travel_minutes: number;
    total_inspection_minutes: number;
    total_transfer_count: number;
  };
};

const BASE = "";

export async function fetchStations(): Promise<Station[]> {
  const res = await fetch(`${BASE}/stations`);
  if (!res.ok) throw new Error("Failed to load stations");
  return res.json();
}

export async function fetchLines(): Promise<Line[]> {
  const res = await fetch(`${BASE}/lines`);
  if (!res.ok) throw new Error("Failed to load lines");
  return res.json();
}

export async function fetchPlan(payload: PlanRequest): Promise<PlanResponse> {
  const res = await fetch(`${BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return res.json();
}
