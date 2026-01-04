import requests

URL = "https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb"
KEY = "VeIA8Xlxkm7UW9PhBdr9Pg3xiE9h8tep"

def test_api():
    print(f"Testing connection to {URL}...")
    try:
        response = requests.get(URL, params={"key": KEY}, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Headers: {response.headers}")
        print(f"Content-Length: {len(response.content)} bytes")
        
        if response.status_code == 200:
            print("Success! Data received.")
            # Save a sample for inspection if needed
            with open("sample_feed.pb", "wb") as f:
                f.write(response.content)
            print("Saved response to sample_feed.pb")
        else:
            print(f"Error: {response.text}")
            
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    test_api()
