FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
# Mount a volume at /app/data so snapshots survive restarts, then run
# "docker exec <container> npm run ingest" to fetch the guidance.
CMD ["npx", "tsx", "src/server/index.ts"]
