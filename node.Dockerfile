FROM node:24-slim as builder

ENV NODE_ENV build

RUN corepack enable
USER node
WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN pnpm run build
RUN pnpm prune --prod

# ---

FROM node:24-slim

ENV NODE_ENV production

USER node
WORKDIR /usr/src/app

COPY --from=builder --chown=node:node /usr/src/app/package*.json /usr/src/app/.env.example ./
COPY --from=builder --chown=node:node /usr/src/app/node_modules/ ./node_modules/
COPY --from=builder --chown=node:node /usr/src/app/dist/ ./dist/

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
