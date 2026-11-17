# syntax=docker/dockerfile:1

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
WORKDIR /app

COPY backend/package.json ./package.json
RUN npm install --omit=dev

COPY backend/src ./src
COPY database/migrations ./database/migrations

USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
