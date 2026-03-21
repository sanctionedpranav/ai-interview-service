# Production-ready Dockerfile for AI Interview Service

FROM node:20-slim

# Install system dependencies for audio processing, TTS, and native Node modules
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p public/audio uploads models/piper

# Download Piper model placeholder (Real implementation would download from bucket)
# RUN wget -O models/piper/en_US-lessac-medium.onnx https://...

# Expose port used by the AI service
EXPOSE 5005

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5005
ENV AI_INTERVIEW_CONCURRENCY=20
ENV REDIS_HOST=localhost
ENV REDIS_PORT=6379

# Start the service
CMD ["node", "src/server.js"]
