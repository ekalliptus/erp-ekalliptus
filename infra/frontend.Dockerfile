FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG BACKEND_URL=http://backend-api:3000
ENV BACKEND_URL=$BACKEND_URL NEXT_TELEMETRY_DISABLED=1
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 BACKEND_URL=http://backend-api:3000
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3100
CMD ["npm", "start"]
