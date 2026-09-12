FROM python:3.11-slim

# System dependencies for OpenCV and PaddlePaddle
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Replace CUDA PyTorch with CPU-only PyTorch
RUN pip uninstall -y torch torchvision && \
    pip install --no-cache-dir \
    torch==2.6.0+cpu \
    torchvision==0.21.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# Copy source
COPY . .

# Create necessary directories
RUN mkdir -p /app/data/sample_videos /app/models /app/data/snapshots

# Pre-download PaddleOCR models
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en', show_log=False)" || true

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]