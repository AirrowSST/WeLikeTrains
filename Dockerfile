FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Cloud builds contain neither Git nor .git, so lifecycle scripts are skipped
# while installing dependencies.
RUN npm ci --ignore-scripts
COPY . .
# Deployment only needs runnable client and server bundles. Type checking and
# broader test suites remain explicit local checks rather than Cloud Build gates.
RUN npm run build:deploy

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/data ./data
USER node
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
