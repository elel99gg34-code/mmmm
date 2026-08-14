# PlayHub — one image that serves both the web client and the realtime hub.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so a code-only change reuses the layer.
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm install --omit=dev --no-audit --no-fund

# The server imports the engines from shared/, and serves the client from the
# repository root, so all three go into the image.
COPY shared/ ./shared/
COPY server/ ./server/
COPY app/ ./app/
COPY index.html .nojekyll ./

# Drop privileges — the node image ships a suitable unprivileged user.
USER node

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
