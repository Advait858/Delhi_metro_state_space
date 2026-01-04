# Delhi Metro Auditor

## Problem statement
Plan a multi-day audit over all Delhi Metro stations with:
- GTFS-derived travel times and line geometry
- line-aware transfer penalties via an expanded graph
- hub inspection service times
- daily time budgets with mandatory return to the same base each day

## Data sources
- Use official DMRC GTFS static data from the Government of NCT of Delhi Open Transit Data portal.
- Required GTFS files: `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`.
- Optional: `shapes.txt` for line geometry.

Place GTFS files in `data/gtfs` (gitignored) or set `GTFS_PATH` to a custom directory.

Optional download helper:
```bash
python scripts/download_gtfs.py --url <OFFICIAL_GTFS_ZIP_URL> --out-dir data/gtfs --checksum <SHA256>
```

## Math overview
1) Expanded graph \(G=(V,E)\)
   - Node: \((s,\ell)\) = station \(s\) on line \(\ell\)
   - Ride edges: consecutive stations on line \(\ell\)
   - Transfer edges: \((s,\ell_1)\to(s,\ell_2)\) with station-specific penalty

2) Station-level metric closure
   - Service nodes are stations, not station-line pairs
   - Travel cost:
     \[
     c(s_i,s_j)=\min_{\ell_i\in L(s_i),\ell_j\in L(s_j)} \text{SP}((s_i,\ell_i)\to(s_j,\ell_j))
     \]

3) Multi-day VRP heuristic
   - Each day is a route starting/ending at base with budget \(B\)
   - Service time \(\tau_{insp}(s)\) added once per station (single/2-line/3+ table + overrides)
   - Objective: lexicographic minimize days, then total time

Transfer penalty model (defaults):
- 2-line interchange: `two_line_minutes`
- 3+ line interchange: scaled by line count using `three_plus_minutes` and `two_line_minutes`
- Station-specific overrides supported for hubs and large stations

Base inspection:
- Base station is excluded from the inspection set by default.

## Project layout
```
/backend  FastAPI + planner
/frontend Vite React UI
/docs     Notes and references
/scripts  Helpers (download)
/data     GTFS data (gitignored)
```

## Backend
Endpoints:
- `GET /health`
- `GET /stations`
- `GET /lines`
- `POST /plan`

## Frontend
- Canvas renderer with line polylines and station dots
- Animated inspector trace with per-day stats
- Export JSON/CSV

## Running locally
Backend:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set GTFS_PATH=..\data\gtfs
uvicorn app.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## Demo workflow
1) Place GTFS data in `data/gtfs`.
2) Start backend and frontend.
3) Choose a base station and parameters.
4) Generate plan, animate, export.
