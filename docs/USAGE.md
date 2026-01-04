# Delhi Metro Auditor - Usage Guide

## Quick Start
The application is already running!

1.  **Frontend**: Open [http://localhost:5173](http://localhost:5173) in your browser.
2.  **Backend API**: Running at [http://localhost:8000](http://localhost:8000).

## How to Use
1.  **Select Base Station**: Choose a starting station (e.g., "Kashmere Gate") from the dropdown.
2.  **Set Constraints**:
    - **Daily Budget**: Max minutes per day (e.g., 420 for 7 hours).
    - **Inspection Times**: Adjust how long it takes to audit single vs. interchange stations.
3.  **Generate Plan**: Click the button. The solver (Python) calculates optimal routes.
4.  **Visualize**:
    - **Map**: Watch the "Auditor" animate through the network.
    - **Days**: Use the dropdown to jump between Day 1, Day 2, etc.
    - **Stats**: View total days and transfer counts at the top.

## Troubleshooting
- **Server Logs**: Check the terminal output where `uvicorn` and `vite` are running.
- **Data**: The system uses the static GTFS files provided in `backend/data/gtfs`.
    - To update data, replace files in `...\experiment 1\backend\data\gtfs`.
    - Restart the backend if you change data files.

## Project Structure
- `backend/`: FastAPI Python server + VRP Solver (`planner.py`).
- `frontend/`: React + Vite application.
- `data/gtfs/`: User-provided static GTFS files.
