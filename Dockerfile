# syntax=docker/dockerfile:1

FROM node:22-bookworm AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm AS browser
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production HOME=/tmp
COPY package.json ./
RUN PLAYWRIGHT_VERSION="$(node -p "require('./package.json').dependencies.playwright")" \
    && npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /tmp/.npm
COPY --from=dependencies /app/package.json /app/package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
RUN npx --no-install playwright install chromium \
    && rm -rf /tmp/.npm
RUN mkdir -p out && chown node:node out
COPY src/ ./src/
USER node
CMD ["node", "src/index.js"]
