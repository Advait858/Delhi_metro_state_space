```typescript
import { useState, useEffect, useRef, useMemo } from "react";
import { Station, Line, PlanResponse, fetchStations, fetchLines, fetchPlan, Route } from "./api";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Slider } from "./components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Play, RefreshCw, Download, Sun, Moon, Clock, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface DayPlan {
  stations: string[];
  segments: PathSegment[];
  day_number: number;
  lines_used: string[];
  minutes: number;
}

interface PathSegment {
  coords: number[][]; // [[lat, lon], ...]
  line_id: string; // The application uses line_id, need to ensure backend sends it or map it
  minutes: number;
}

function computeBounds(stations: Station[], lines: Line[]): Bounds {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;

  if (stations.length === 0 && lines.length === 0) {
    return { minLat: 28.5, maxLat: 28.7, minLon: 77.1, maxLon: 77.3 };
  }

  stations.forEach((s) => {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  });

  lines.forEach((l) =>
    l.polyline.forEach((p) => {
      if (p[0] < minLat) minLat = p[0];
      if (p[0] > maxLat) maxLat = p[0];
      if (p[1] < minLon) minLon = p[1];
      if (p[1] > maxLon) maxLon = p[1];
    })
  );

  return { minLat, maxLat, minLon, maxLon };
}

function latLonToXY(
  lat: number,
  lon: number,
  bounds: Bounds,
  width: number,
  height: number,
  padding = 32
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

  const x =
    xOffset +
    padding +
    ((lon - bounds.minLon) / lonSpan) * (renderWidth - 2 * padding);
  const y =
    yOffset +
    padding +
    (1 - (lat - bounds.minLat) / latSpan) * (renderHeight - 2 * padding);
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

function buildTimedSegments(day: DayPlan | null, lines: Line[]): { points: number[][]; durationMs: number; lineColor: string }[] {
  if (!day) return [];
  const lineMap = new Map(lines.map(line => [line.id, line]));
  return day.segments.map((seg) => ({
    points: seg.coords,
    durationMs: seg.minutes * 1000,
    lineColor: lineMap.get(seg.line_id)?.color ? `#${ lineMap.get(seg.line_id)!.color!.replace("#", "") } ` : "#9bd2c9"
  }));
}

function drawTrain(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    // Train Scaling
    const w = 24; 
    const h = 10; 
    
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.roundRect(-w/2 + 2, -h/2 + 2, w, h, 3);
    ctx.fill();

    // Body
    ctx.fillStyle = "#fff"; // Train body usually white/silver
    ctx.beginPath();
    ctx.roundRect(-w/2, -h/2, w, h, 3);
    ctx.fill();
    
    // Stripe (Line Color)
    ctx.fillStyle = color;
    ctx.fillRect(-w/2, -h/2 + 3, w, 4);

    // Front Window (Windshield)
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(w/2, -h/2 + 1);
    ctx.lineTo(w/2 - 4, -h/2 + 1);
    ctx.lineTo(w/2 - 4, h/2 - 1);
    ctx.lineTo(w/2, h/2 - 1);
    ctx.fill();

    // Headlights
    ctx.fillStyle = "#ffcc00"; // yellow lights
    ctx.beginPath();
    ctx.arc(w/2 - 1, -h/2 + 2, 1, 0, Math.PI*2);
    ctx.arc(w/2 - 1, h/2 - 2, 1, 0, Math.PI*2);
    ctx.fill();
    
    // Red Tail lights (back)
    ctx.fillStyle = "#ff0000";
    ctx.beginPath();
    ctx.arc(-w/2 + 1, -h/2 + 2, 1, 0, Math.PI*2);
    ctx.arc(-w/2 + 1, h/2 - 2, 1, 0, Math.PI*2);
    ctx.arc(-w/2 + 1, h/2 - 2, 1, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
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

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${ h }h ${ m.toString().padStart(2, '0') } m`;
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
  const [speed, setSpeed] = useState<number>(60); // Speed multiplier
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<{ start: number; running: boolean }>({
    start: 0,
    running: false,
  });

  // Load Initial Data
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
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
  
  // Flatten current day segments for animation
  const day = plan?.days[selectedDay] ?? null;
  const routePoints = useMemo(() => flattenRoutePoints(day), [day]);
  const timedSegments = useMemo(() => buildTimedSegments(day, lines), [day, lines]);

  // Canvas Mouse Handling for Hover
  const handleMouseMove = (e: React.MouseEvent) => {
      if (!canvasRef.current || !bounds) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      let found: Station | null = null;
      const width = rect.width;
      const height = rect.height;

      for (const s of stations) {
          const { x, y } = latLonToXY(s.lat, s.lon, bounds, width, height);
          const dist = Math.sqrt((x - mx) ** 2 + (y - my) ** 2);
          if (dist < 10) { 
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
      // Handle High DPI
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      
      // Theme colors
      const isDark = theme === "dark";
      // Colors derived from tokens would be ideal, but for canvas we hardcode to match
      const bgColor = "transparent"; // Canvas is transparent, bg handled by container
      const stationColor = isDark ? "#ffffff" : "#0f172a"; 
      const stationActiveColor = "#2dd4bf"; // Teal-400
      const routeColor = "#2dd4bf";
      const routeGlow = "rgba(45, 212, 191, 0.4)";

      ctx.clearRect(0, 0, width, height);

      // Draw Lines (Glow Pass)
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      
      lines.forEach((line) => {
        if (!line.polyline || line.polyline.length < 2) return;
        const color = line.color ? `#${ line.color.replace("#", "") } ` : "#9bd2c9";
        
        ctx.beginPath();
        line.polyline.forEach((pt, idx) => {
          const { x, y } = latLonToXY(pt[0], pt[1], bounds, width, height);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        
        // Glow
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.2;
        ctx.lineWidth = 8;
        ctx.stroke();
        
        // Core
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Draw Route Highlight (Active Path)
      if (routePoints.length > 1) {
        ctx.beginPath();
        routePoints.forEach((pt, idx) => {
          const { x, y } = latLonToXY(pt[0], pt[1], bounds, width, height);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        
        ctx.strokeStyle = routeGlow;
        ctx.lineWidth = 12;
        ctx.lineCap = "round";
        ctx.stroke();
        
        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // Draw Stations
      const inspected = new Set(day?.stations ?? []);
      stations.forEach((s) => {
        const { x, y } = latLonToXY(s.lat, s.lon, bounds, width, height);
        const isActive = inspected.has(s.id);
        const isHovered = hoveredStation?.id === s.id;
        
        // Glow for active/hovered
        if (isActive || isHovered) {
             ctx.beginPath();
             ctx.arc(x, y, 12, 0, Math.PI * 2);
             ctx.fillStyle = routeGlow;
             ctx.fill();
        }

        ctx.beginPath();
        const radius = isActive ? 5 : 3;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? stationActiveColor : (isDark ? "rgb(255 255 255 / 0.5)" : "rgb(0 0 0 / 0.5)");
        ctx.fill();
        
        if (isActive) {
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Label if hovered
        if (isHovered) {
            ctx.fillStyle = isDark ? "#fff" : "#000";
            ctx.font = "bold 14px 'Inter', sans-serif";
            ctx.fillText(s.name, x + 15, y + 5);
        }
      });
      
      // Animation train
      if (timeMs !== undefined && timedSegments.length > 0) {
        const elapsed = Math.max(0, timeMs - animationRef.current.start);
        const scaled = elapsed * speed;
        let remaining = scaled;
        let currentPoint: number[] | null = null;
        let nextPoint: number[] | null = null;
        let trainColor = "#fff";

        for (const seg of timedSegments) {
          const segmentDuration = Math.max(seg.durationMs, 1);
          if (remaining <= segmentDuration) {
            const points = seg.coords; // Use seg.coords directly
            trainColor = seg.lineColor;
            
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
              nextPoint = p2;
            }
            break;
          }
          remaining -= segmentDuration;
        }
        
        if (currentPoint) {
            const { x, y } = latLonToXY(currentPoint[0], currentPoint[1], bounds, width, height);
            let angle = 0;
            if (nextPoint) {
                const { x: nx, y: ny } = latLonToXY(nextPoint[0], nextPoint[1], bounds, width, height);
                if (x !== nx || y !== ny) {
                    angle = Math.atan2(ny - y, nx - x);
                }
            }
            drawTrain(ctx, x, y, angle, trainColor);
        }
      }
    };

    let animationId: number;
    const renderLoop = (time: number) => {
      if (!animationRef.current.running) {
        animationRef.current.start = time; // Reset start time relative to now if just starting
      }
      animationRef.current.running = true;
      draw(time);
      animationId = requestAnimationFrame(renderLoop);
    };

    animationId = requestAnimationFrame(renderLoop);
    return () => {
        cancelAnimationFrame(animationId);
        animationRef.current.running = false;
    };
  }, [stations, lines, bounds, routePoints, timedSegments, speed, theme, hoveredStation]); // Dependencies

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const p = await fetchPlan({
        start_station_id: baseStation,
        daily_budget: dailyBudget,
        speed_factor: 1.0,
      });
      setPlan(p);
      setSelectedDay(0);
      animationRef.current = { start: performance.now(), running: true };
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!plan) return;
    downloadFile("inspection_plan.json", JSON.stringify(plan, null, 2), "application/json");
  };

  const prevDay = () => setSelectedDay((d) => Math.max(0, d - 1));
  const nextDay = () => setSelectedDay((d) => Math.min((plan?.days.length || 1) - 1, d + 1));
  const totalDays = plan?.days.length || 0;

  return (
            </select>
          </div>
        </section>
      </main>
    </div>
  );
}
