# ---------- build stage ----------
FROM node:20-slim AS build
WORKDIR /app

# install dev deps (includes TS types)
COPY package.json package-lock.json* ./
RUN npm ci

# compile TS
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# install only prod deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# copy compiled JS
COPY --from=build /app/dist ./dist

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node", "dist/server.js"]
