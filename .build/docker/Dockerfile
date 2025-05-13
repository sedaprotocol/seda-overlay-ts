FROM oven/bun:latest AS builder

WORKDIR /app

COPY . .

RUN bun install

# Just for building the bundle that Node.js needs
RUN bun run build:node

FROM node:23.11.0-bullseye AS runner

WORKDIR /app

COPY --from=builder /app/build ./build

CMD ["node", "./build/bundle.cjs", "run", "--network", "testnet"]
