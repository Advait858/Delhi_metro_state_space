import logging
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.gtfs import load_gtfs
from app.planner import build_plan

logging.basicConfig(level=logging.WARNING)

def debug():
    print("Loading GTFS...")
    gtfs = load_gtfs("data/gtfs")
    print(f"Loaded {len(gtfs.stations)} stations.")
    
    start_station = list(gtfs.stations.keys())[0]
    print(f"Planning from {start_station} with budget 420...")
    
    try:
        routes, _, _, _, _, _ = build_plan(
            gtfs, 
            start_station_id=start_station, 
            daily_budget=420,
            inspection_single=4,
            inspection_two_line=7,
            inspection_three_plus=10,
            inspection_overrides={},
            transfer_two=4,
            transfer_three=6,
            transfer_overrides={},
            base_inspection=False,
            max_days=30
        )
        print("Success!")
        for i, r in enumerate(routes):
            print(f"Day {i+1}: {len(r.stations)} stations")
    except Exception as e:
        print(f"Solver failed: {e}")

if __name__ == "__main__":
    debug()
