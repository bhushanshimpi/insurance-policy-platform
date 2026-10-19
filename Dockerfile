FROM node:22-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/tmp/uploads && chown -R app:app /app

USER app

EXPOSE 3000

CMD ["node", "src/server.js"]
