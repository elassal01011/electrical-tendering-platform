# Development-oriented Dockerfile. For a leaner production image, add a
# multi-stage build with `next build` + `next start` on a slim runtime
# once the app has grown past this foundation pass.
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN chmod +x scripts/docker-entrypoint.sh

EXPOSE 3000

CMD ["sh", "./scripts/docker-entrypoint.sh"]
