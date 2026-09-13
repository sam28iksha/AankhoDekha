FROM python:3.11-slim

# System dependencies for OpenCV, PaddlePaddle, and C-extension compilation
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    wget \
    build-essential \
    python3-dev \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache optimization)
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

# Force a clean build of pyclipper to avoid the corrupted binary wheel issue
RUN pip install --no-cache-dir --force-reinstall --no-binary pyclipper pyclipper==1.3.0.post5

# Copy source
COPY . .

# Create necessary directories
RUN mkdir -p /app/data/sample_videos /app/models /app/data/snapshots

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]