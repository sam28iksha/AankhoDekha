# ── Build stage ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Build
COPY . .
ARG VITE_API_URL=http://localhost:8000
ARG VITE_WS_URL=ws://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

# ── Serve stage ───────────────────────────────────────────────────
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config — SPA fallback + proxy to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
