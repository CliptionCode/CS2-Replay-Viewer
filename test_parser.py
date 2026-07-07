import json
import subprocess
import sys

# Parse the path from arguments
if len(sys.argv) < 2:
    print("Usage: python test_parser.py \"path/to/demo.dem\"")
    sys.exit(1)

path = sys.argv[1]

# Create request
request = {"path": path}

# Run the Go sidecar
proc = subprocess.Popen(
    ["backend/cs2-parser.exe"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

stdout, stderr = proc.communicate(json.dumps(request).encode())

if proc.returncode != 0:
    print(f"Parser failed: {stderr.decode()}")
    sys.exit(1)

# Parse response
response = json.loads(stdout.decode())

if response["success"]:
    print(f"Success! Parsed demo path: {path}")
    print(f"Base64 protobuf length: {len(response['data'])} chars")
else:
    print(f"Parser failed: {response['error']}")
    sys.exit(1)
