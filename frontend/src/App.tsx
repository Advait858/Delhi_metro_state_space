import { useEffect, useMemo, useRef, useState } from "react";
import {
  DayPlan,
  Line,
  PlanRequest,
  PlanResponse,
  Station,
  fetchLines,
  fetchPlan,
  fetchStations
} from "./api";

type Bounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

function computeBounds(stations: Station[], lines: Line[]): Bounds | null {
  const points: number[][] = [];
  lines.forEach((line) => line.polyline.forEach((p) => points.push(p)));
  if (points.length === 0) {
    stations.forEach((s) => points.push([s.lat, s.lon]));
  }
  if (points.length === 0) return null;
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons)
  };
}

function latLonToXY(
  lat: number,
  lon: number,
  bounds: Bounds,
  width: number,
  height: number,
  padding = 30
) {
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  const lonSpan = bounds.maxLon - bounds.minLon || 1;
  const x = padding + ((lon - bounds.minLon) / lonSpan) * (width - 2 * padding);
  const y = padding + (1 - (lat - bounds.minLat) / latSpan) * (height - 2 * padding);
  return { x, y };
}

function flattenRoutePoints(day: DayPlan | null): number[][] {
  if (!day) return [];
  const points: number[][] = [];
  day.segments.forEach((seg) => {
    seg.coords.forEach((p) => {
      const last = points[points.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) {
        points.push(p);
      }
    });
  });
  return points;
}

function buildTimedSegments(day: DayPlan | null): { points: number[][]; durationMs: number }[] {
  if (!day) return [];
  return day.segments.map((seg) => ({
    points: seg.coords,
    durationMs: seg.minutes * 1000
  }));
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [baseStation, setBaseStation] = useState<string>("");
  const [dailyBudget, setDailyBudget] = useState<number>(420);
  const [singleLineMinutes, setSingleLineMinutes] = useState<number>(4);
  const [twoLineMinutes, setTwoLineMinutes] = useState<number>(7);
  const [threePlusMinutes, setThreePlusMinutes] = useState<number>(10);
  const [twoLineXfer, setTwoLineXfer] = useState<number>(4);
  const [threePlusXfer, setThreePlusXfer] = useState<number>(6);
  const [inspectionOverrides, setInspectionOverrides] = useState<string>("{}");
  const [transferOverrides, setTransferOverrides] = useState<string>("{}");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [speed, setSpeed] = useState<number>(60);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<{ start: number; running: boolean }>({ start: 0, running: false });

  useEffect(() => {
    fetchStations()
      .then((data) => {
        setStations(data);
        if (data.length > 0) setBaseStation(data[0].id);
      })
      .catch((err) => setError(String(err)));
    fetchLines().then(setLines).catch((err) => setError(String(err)));
  }, []);

  const bounds = useMemo(() => computeBounds(stations, lines), [stations, lines]);
  const day = plan?.days[selectedDay] ?? null;
  const routePoints = useMemo(() => flattenRoutePoints(day), [day]);
  const timedSegments = useMemo(() => buildTimedSegments(day), [day]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (timeMs?: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = "#0d1411";
      ctx.fillRect(0, 0, width, height);

      lines.forEach((line) => {
        if (!line.polyline || line.polyline.length < 2) return;
        ctx.beginPath();
        line.polyline.forEach((pt, idx) => {
          const { x, y } = latLonToXY(pt[0], pt[1], bounds, width, height);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = `#${line.color || "9bd2c9"}`;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      ctx.fillStyle = "#b4c8c3";
      stations.forEach((s) => {
        const { x, y } = latLonToXY(s.lat, s.lon, bounds, width, height);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      if (routePoints.length > 1) {
        ctx.beginPath();
        routePoints.forEach((pt, idx) => {
          const { x, y } = latLonToXY(pt[0], pt[1], bounds, width, height);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "#f2c879";
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      const inspected = new Set(day?.stations ?? []);
      stations.forEach((s) => {
        if (!inspected.has(s.id)) return;
        const { x, y } = latLonToXY(s.lat, s.lon, bounds, width, height);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffe48a";
        ctx.fill();
      });

      if (timeMs !== undefined && timedSegments.length > 0) {
        const elapsed = Math.max(0, timeMs - animationRef.current.start);
        const scaled = elapsed * speed;
        let remaining = scaled;
        let currentPoint: number[] | null = null;
        for (const seg of timedSegments) {
          const segmentDuration = Math.max(seg.durationMs, 1);
          if (remaining <= segmentDuration) {
            const points = seg.points;
            if (points.length === 1) {
              currentPoint = points[0];
            } else {
              const ratio = remaining / segmentDuration;
              const index = ratio * (points.length - 1);
              const low = Math.floor(index);
              const high = Math.min(points.length - 1, low + 1);
              const t = index - low;
              const p1 = points[low];
              const p2 = points[high];
              currentPoint = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
            }
            break;
          }
          remaining -= segmentDuration;
        }
        if (currentPoint) {
          const { x, y } = latLonToXY(currentPoint[0], currentPoint[1], bounds, width, height);
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.strokeStyle = "#0d1411";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    };

    const animate = (t: number) => {
      draw(t);
      if (animationRef.current.running) {
        requestAnimationFrame(animate);
      }
    };

    draw();
    if (plan && timedSegments.length > 0) {
      animationRef.current.start = performance.now();
      animationRef.current.running = true;
      requestAnimationFrame(animate);
    }

    return () => {
      animationRef.current.running = false;
    };
  }, [bounds, lines, stations, routePoints, timedSegments, speed, plan, day]);

  const handlePlan = async () => {
    setError("");
    setLoading(true);
    try {
      const inspectionOverridesObj = JSON.parse(inspectionOverrides || "{}");
      const transferOverridesObj = JSON.parse(transferOverrides || "{}");
      const payload: PlanRequest = {
        start_station_id: baseStation,
        daily_budget_minutes: dailyBudget,
        inspection: {
          single_line_minutes: singleLineMinutes,
          two_line_minutes: twoLineMinutes,
          three_plus_minutes: threePlusMinutes,
          overrides: inspectionOverridesObj
        },
        transfer: { two_line_minutes: twoLineXfer, three_plus_minutes: threePlusXfer, overrides: transferOverridesObj },
        base_inspection: false
      };
      const data = await fetchPlan(payload);
      setPlan(data);
      setSelectedDay(0);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleExportJson = () => {
    if (!plan) return;
    downloadFile("plan.json", JSON.stringify(plan, null, 2), "application/json");
  };

  const handleExportCsv = () => {
    if (!plan) return;
    let csv = "day,order,station_id\n";
    plan.days.forEach((d) => {
      d.stations.forEach((s, idx) => {
        csv += `${d.day_index},${idx + 1},${s}\n`;
      });
    });
    downloadFile("plan.csv", csv, "text/csv");
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Delhi Metro Auditor</h1>
          <p>Plan multi-day inspections with transfer penalties and GTFS-derived travel times.</p>
        </div>
        <div className="stats">
          <div>
            <span>Days</span>
            <strong>{plan?.stats.total_days ?? "--"}</strong>
          </div>
          <div>
            <span>Total min</span>
            <strong>{plan?.stats.total_minutes.toFixed(1) ?? "--"}</strong>
          </div>
          <div>
            <span>Transfers</span>
            <strong>{plan?.stats.total_transfer_count ?? "--"}</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <h2>Controls</h2>
          <label>
            Base station
            <select value={baseStation} onChange={(e) => setBaseStation(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Daily budget (minutes)
            <input
              type="number"
              value={dailyBudget}
              min={60}
              step={10}
              onChange={(e) => setDailyBudget(Number(e.target.value))}
            />
          </label>
          <div className="grid">
            <label>
              Inspect single-line (min)
              <input
                type="number"
                value={singleLineMinutes}
                min={1}
                step={1}
                onChange={(e) => setSingleLineMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              Inspect 2-line (min)
              <input
                type="number"
                value={twoLineMinutes}
                min={1}
                step={1}
                onChange={(e) => setTwoLineMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              Inspect 3+ line (min)
              <input
                type="number"
                value={threePlusMinutes}
                min={1}
                step={1}
                onChange={(e) => setThreePlusMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              Transfer 2-line (min)
              <input
                type="number"
                value={twoLineXfer}
                min={0}
                step={1}
                onChange={(e) => setTwoLineXfer(Number(e.target.value))}
              />
            </label>
            <label>
              Transfer 3+ (min)
              <input
                type="number"
                value={threePlusXfer}
                min={0}
                step={1}
                onChange={(e) => setThreePlusXfer(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Inspection overrides (JSON)
            <textarea value={inspectionOverrides} onChange={(e) => setInspectionOverrides(e.target.value)} />
          </label>
          <label>
            Transfer overrides (JSON)
            <textarea value={transferOverrides} onChange={(e) => setTransferOverrides(e.target.value)} />
          </label>
          <label>
            Animation speed (x)
            <input
              type="range"
              min={10}
              max={120}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>
          <div className="actions">
            <button onClick={handlePlan} disabled={loading || !baseStation}>
              {loading ? "Planning..." : "Generate Plan"}
            </button>
            <button onClick={handleExportJson} disabled={!plan}>
              Export JSON
            </button>
            <button onClick={handleExportCsv} disabled={!plan}>
              Export CSV
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </section>

        <section className="map">
          <canvas ref={canvasRef} width={900} height={650} />
          <div className="day-selector">
            <span>Day</span>
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(Number(e.target.value))}
              disabled={!plan}
            >
              {plan?.days.map((d, idx) => (
                <option key={d.day_index} value={idx}>
                  Day {d.day_index}
                </option>
              ))}
            </select>
            {day && (
              <div className="day-stats">
                <span>{day.total_minutes.toFixed(1)} min</span>
                <span>{day.transfer_count} transfers</span>
                <span>{day.stations.length} stations</span>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
