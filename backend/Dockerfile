# ─────────────────────────────────────────────
# Stage 1: Build the Go binary
# ─────────────────────────────────────────────
FROM golang:1.24-alpine AS go-builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# ─────────────────────────────────────────────
# Stage 2: Final runtime image (Python + Go binary)
# ─────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for the embed server
# Install PyTorch CPU-only first, then sentence-transformers
RUN pip install --no-cache-dir \
    torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir \
    sentence-transformers==3.4.1

# Pre-download the model so it's baked into the image
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-mpnet-base-v2')"

# Copy Go binary from builder stage
COPY --from=go-builder /app/server /app/server

# Copy Python embed server
COPY embed_server.py /app/embed_server.py

# Copy the entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose Go backend port
EXPOSE 8081

ENTRYPOINT ["/app/entrypoint.sh"]
