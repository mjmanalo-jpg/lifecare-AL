import socket
ip = "111.235.88.23"
port = 554
print(f"Connecting to {ip}:{port}...")
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(3.0)
try:
    s.connect((ip, port))
    print("SUCCESS: Port is open!")
    s.close()
except Exception as e:
    print(f"FAILED: {e}")
