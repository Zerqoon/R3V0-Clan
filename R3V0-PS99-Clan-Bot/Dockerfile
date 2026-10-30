FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# gosu lets the entrypoint repair ownership of a Railway-mounted volume as root,
# then immediately drop privileges before starting the Node.js process.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN npm run check
RUN npm test
RUN npm run preview

RUN useradd --system --uid 10001 --create-home bot \
  && mkdir -p /app/data /app/preview \
  && chown -R bot:bot /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

# Do not set USER bot here: Railway mounts volumes at runtime, after image build.
# The entrypoint fixes the mounted directory ownership and then drops to bot.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
EXPOSE 3000
