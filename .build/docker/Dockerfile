FROM oven/bun:1.2

ARG BUN_TARGET_ARCH
ARG NETWORK_NAME=testnet

WORKDIR /app

COPY . .

RUN bun install

RUN bun run build:node
RUN ls -la /app/build

RUN ldd ./build/seda-overlay-linux-x64 || echo "ldd failed"


RUN ./build/seda-overlay-linux-x64 init --network testnet

ENTRYPOINT ["./build/seda-overlay-linux-x64"]
CMD ["run", "--network", "testnet"]
