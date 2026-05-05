#!/bin/sh
set -e

# Start the Python embed server in the background
echo "Starting Python embed server on port 8001..."
python /app/embed_server.py &

# Wait for the embed server to be ready
echo "Waiting for embed server to start..."
sleep 8

# Start the Go HTTP server in the foreground
echo "Starting Go backend server on port 8081..."
exec /app/server
