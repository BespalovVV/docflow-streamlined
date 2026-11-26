FROM node:20-slim

WORKDIR /app

# Системные пакеты для healthcheck (curl) и нативных библиотек ONNX Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/uploads /app/.hf_cache \
  && chown -R node:node /app \
  && chmod -R 775 /app/uploads /app/.hf_cache

USER node

EXPOSE 3000

CMD ["node", "backend/server.js"]
