FROM node:24-slim

# Some transitive deps (utf-8-validate via websocket, pulled in by telegram) ship native addons
# with no prebuilt binary for this platform, so node-gyp must compile them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached between source changes.
# Full install (not --omit=dev): tsx and vite are devDependencies and are needed at runtime/build.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0

# Railway injects PORT. server listens on it via env.PORT.
CMD ["npm", "start"]
