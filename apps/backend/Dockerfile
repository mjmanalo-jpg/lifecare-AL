# Use official lightweight Python image
FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffer stdout/stderr
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000 \
    CAMERA_IP=rtsp://pj.pitogo%40resoluteaiph.com:123123%40Paul@111.235.88.23:554/stream1

# Set working directory
WORKDIR /app

# Copy dependencies manifest and install
COPY apps/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY apps/backend/ .

# Expose port and bind to the dynamic port Render provides
EXPOSE 10000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
