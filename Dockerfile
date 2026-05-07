# NOTE: Build context must be the parent directory containing both
# event-catalog/ and ui-components/ as siblings. docker-compose uses
# context: .. (relative to event-catalog/) to achieve this.

FROM node:20-alpine AS builder
WORKDIR /app

# Copy ui-components (needed for admin UI: file: dep + Vite @ui alias)
COPY ui-components/ /ui-components/

# Install and compile the server
COPY event-catalog/package.json event-catalog/package-lock.json* ./
RUN npm install
COPY event-catalog/tsconfig.json ./
COPY event-catalog/src/ ./src/
RUN npx tsc

# Build the admin UI
WORKDIR /app/src/admin
RUN npm install
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY event-catalog/package.json event-catalog/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/admin/dist ./dist/admin/dist
EXPOSE 3010
CMD ["node", "dist/cli/index.js"]
