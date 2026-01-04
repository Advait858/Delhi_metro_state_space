import sys
import os
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.gtfs import load_gtfs
from app.graph import build_expanded_graph
from app.planner import compute_transfer_penalties

def find_disconnected():
    print("Loading GTFS...")
    gtfs = load_gtfs("data/gtfs")
    print(f"Loaded {len(gtfs.stations)} stations.")
    
    penalties = compute_transfer_penalties(gtfs, 4, 6, {})
    graph, station_to_lines = build_expanded_graph(gtfs, penalties, base_station_id=None)
    
    # Run BFS from a main station (e.g., Rajiv Chowk = 50, or Dilshad Garden = 1)
    start_station = "50"
    if start_station not in station_to_lines:
        print(f"Start station {start_station} not found!")
        return

    print(f"Computing reachability from {start_station}...")
    
    reachable_nodes = set()
    queue = []
    
    # Add all nodes corresponding to start_station
    for line_id in station_to_lines[start_station]:
        node_id = graph.node_to_id.get((start_station, line_id))
        if node_id is not None:
            queue.append(node_id)
            reachable_nodes.add(node_id)
            
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        for v, w in graph.adj.get(u, []):
            if v not in reachable_nodes:
                reachable_nodes.add(v)
                queue.append(v)
                
    # Check which stations are not reachable
    reachable_stations = set()
    for node_id in reachable_nodes:
        node = graph.id_to_node[node_id]
        reachable_stations.add(node.station_id)
        
    all_stations = set(gtfs.stations.keys())
    disconnected = all_stations - reachable_stations
    
    print(f"Reachable Stations: {len(reachable_stations)}")
    print(f"Disconnected Stations ({len(disconnected)}):")
    for s in sorted(list(disconnected)):
        name = gtfs.stations[s].name
        print(f"  {s}: {name}")

if __name__ == "__main__":
    find_disconnected()
