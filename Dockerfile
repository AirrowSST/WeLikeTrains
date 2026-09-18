FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The package prepare hook configures local Git hooks. Cloud builds contain
# neither Git nor .git, so dependency installation must skip workstation hooks.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

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
