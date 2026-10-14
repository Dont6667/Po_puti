FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY public ./public
COPY scripts ./scripts
COPY initial-content.json ./
RUN npm run build && npm prune --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node *.mjs ./
COPY --chown=node:node initial-content.json ./
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/data /app/public/assets/uploads && chown -R node:node /app/data /app/public/assets/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
