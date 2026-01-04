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
import "./styles/app.css";

type Bounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

// ... (helper functions kept same or similar)
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
  padding = 40
) {
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  const lonSpan = bounds.maxLon - bounds.minLon || 1;
  // Center content
  const mapRatio = width / height;
  const contentRatio = lonSpan / latSpan;

  let renderWidth = width;
  let renderHeight = height;

  if (contentRatio > mapRatio) {
    renderHeight = renderWidth / contentRatio;
  } else {
    renderWidth = renderHeight * contentRatio;
  }

  const xOffset = (width - renderWidth) / 2;
  const yOffset = (height - renderHeight) / 2;

  const x = xOffset + padding + ((lon - bounds.minLon) / lonSpan) * (renderWidth - 2 * padding);
  const y = yOffset + padding + (1 - (lat - bounds.minLat) / latSpan) * (renderHeight - 2 * padding);
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [stations, setStations] = useState<Station[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [baseStation, setBaseStation] = useState<string>("");
  const [dailyBudget, setDailyBudget] = useState<number>(420);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [speed, setSpeed] = useState<number>(60);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<{ start: number; running: boolean }>({ start: 0, running: false });

  // Load Initial Data
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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

  // Canvas Mouse Handling for Hover
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current || !bounds) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check distance to stations (simple reverse projection is hard, so loop screen coords)
    // Optimization: This runs every frame on mouse move, iterate all stations is okay for <300 items
    let found: Station | null = null;
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    // Note: we need to use the exact same transform logic
    // We'll recalc it or memoize it. For now, recalc.
    for (const s of stations) {
      const { x, y } = latLonToXY(s.lat, s.lon, bounds, width, height);
      const dist = Math.sqrt((x - mx) ** 2 + (y - my) ** 2);
      if (dist < 10) { // 10px radius
        found = s;
        break;
      }
    }
    setHoveredStation(found);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (timeMs?: number) => {
      const width = canvas.clientWidth;  // Use CSS size
      const height = canvas.clientHeight;
      // High DPI scaling could be added here
      canvas.width = width;
      canvas.height = height;

      const isDark = theme === "dark";
      const bgColor = isDark ? "#0d1411" : "#e6e8eb";
      const stationColor = isDark ? "#b4c8c3" : "#57606a";
      const stationActiveColor = isDark ? "#ffe48a" : "#d29922";
      const routeColor = isDark ? "#f2c879" : "#d29922";
      const textColor = isDark ? "#fff" : "#000";

      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      // Draw Lines
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      lines.forEach((line) => {
        if (!line.polyline || line.polyline.length < 2) return;
        ctx.beginPath();
        line.polyline.forEach((pt, idx) => {
          const { x, y } = latLonToXY(pt[0], pt[1], bounds, width, height);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        let color = line.color ? `#${line.color.replace("#", "")}` : "#9bd2c9";
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Draw Route Highlight
      if (routePoints.length > 1) {
        ctx.beginPath();
        routePoints.forEach((pt, idx) => {
          const { x, y } = latLonToXY(pt[0], pt[1], bounds, width, height);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw Stations
      const inspected = new Set(day?.stations ?? []);
      stations.forEach((s) => {
        const { x, y } = latLonToXY(s.lat, s.lon, bounds, width, height);
        ctx.beginPath();

        const isActive = inspected.has(s.id);
        const radius = isActive ? 5 : 3;

        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? stationActiveColor : stationColor;
        ctx.fill();

        // Label if active or hovered
        if (hoveredStation?.id === s.id) {
          ctx.fillStyle = textColor;
          ctx.font = "bold 14px 'Outfit', sans-serif";
          ctx.fillText(s.name, x + 10, y + 4);
        } else if (isActive && width > 800) { // Show active labels on large screens
          // Use smaller font for active but not hovered
          // ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
          // ctx.font = "10px sans-serif";
          // ctx.fillText(s.name, x + 8, y + 3);
        }
      });

      // Animation train
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
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#000";
          ctx.stroke();

          // Ripple effect
          const ripple = (timeMs / 500) % 1;
          ctx.beginPath();
          ctx.arc(x, y, 8 + ripple * 20, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${1 - ripple})`;
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
      if (!animationRef.current.running) {
        animationRef.current.start = performance.now();
        animationRef.current.running = true;
        requestAnimationFrame(animate);
      }
    } else {
      animationRef.current.running = false;
    }

    return () => {
      animationRef.current.running = false;
    };
  }, [bounds, lines, stations, routePoints, timedSegments, speed, theme, hoveredStation]);

  const handlePlan = async () => {
    setError("");
    setLoading(true);
    try {
      const payload: PlanRequest = {
        start_station_id: baseStation,
        daily_budget_minutes: dailyBudget,
        inspection: {
          single_line_minutes: 4,
          two_line_minutes: 7,
          three_plus_minutes: 10,
          overrides: {}
        },
        transfer: { two_line_minutes: 4, three_plus_minutes: 6, overrides: {} },
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

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Delhi Metro Auditor</h1>
          <div style={{ opacity: 0.7, fontSize: 14 }}>Automated Inspection Planner</div>
        </div>

        <div className="header-controls">
          <div className="stats">
            <div className="stat-pill">
              <span>Days</span>
              <strong>{plan?.stats.total_days ?? "--"}</strong>
            </div>
            <div className="stat-pill">
              <span>Total Time</span>
              <strong>{plan?.stats.total_minutes.toFixed(0) ?? "--"}m</strong>
            </div>
          </div>

          <button
            className="theme-toggle"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title="Toggle Theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <h2>Configuration</h2>

          <div className="control-group">
            <label>Start Station</label>
            <select value={baseStation} onChange={(e) => setBaseStation(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Daily Budget (min)</label>
            <input
              type="number"
              value={dailyBudget}
              min={60}
              step={30}
              onChange={(e) => setDailyBudget(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>Animation Speed</label>
            <input
              type="range"
              className="range-slider"
              min={10}
              max={200}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </div>

          <div className="actions">
            <button className="primary" onClick={handlePlan} disabled={loading || !baseStation}>
              {loading ? "Calculating Route..." : "GENERATE PLAN"}
            </button>
            <button className="secondary" onClick={() => {
              if (plan) downloadFile("plan.json", JSON.stringify(plan, null, 2), "application/json");
            }} disabled={!plan}>
              Export JSON
            </button>
          </div>

          {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        </aside>

        <section className="map-container">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            style={{ width: '100%', height: '100%', cursor: hoveredStation ? 'pointer' : 'default' }}
          />

          <div className="day-selector">
            <span style={{ opacity: 0.6 }}>Day View</span>
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(Number(e.target.value))}
              disabled={!plan}
            >
              {plan?.days.map((d, idx) => (
                <option key={d.day_index} value={idx}>Day {d.day_index}</option>
              ))}
              {!plan && <option>--</option>}
            </select>
          </div>
        </section>
      </main>
    </div>
  );
}
