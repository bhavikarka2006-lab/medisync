# Multi-stage build -> small, non-root production image (DevOps: containerization)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
