# Docker Setup

Simple Docker setup to serve your static Next.js app with nginx.

## Usage

```bash
# Build the Docker image
npm run docker:build

# Run the container (serves on port 3000)
npm run docker:run

# Stop the container
npm run docker:stop
```

## Manual Docker Commands

```bash
# Build
docker build -f docker/Dockerfile -t routstr-chat .

# Run
docker run -d -p 3000:80 --name routstr-chat routstr-chat

# Stop
docker stop routstr-chat && docker rm routstr-chat
```

## What it does

1. Builds your Next.js app as static files
2. Serves them with nginx
3. Handles SPA routing (all routes fallback to index.html)
4. Optimizes static assets with caching and compression

Final image size: ~27MB
