FROM oven/bun:1.2-alpine

ARG BUN_TARGET_ARCH
ARG NETWORK_NAME=testnet

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile

# Build the seda-overlay executable from the cli package
#RUN bun build --compile --minify --sourcemap ./packages/cli/src/index.ts --outfile seda-overlay --target=${BUN_TARGET_ARCH}
RUN bun build:node

RUN ./build/seda-overlay-linux-x64 init --network testnet

ENTRYPOINT ["./build/seda-overlay-linux-x64"]
CMD ["run", "--network", "testnet"]
