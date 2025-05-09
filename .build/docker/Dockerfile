FROM oven/bun:1.2-alpine

ARG TARGET_ARCH
ARG NETWORK_NAME=testnet

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile

# Build the seda-overlay executable from the cli package
RUN bun build --compile --minify --sourcemap ./packages/cli/src/index.ts --outfile seda-overlay --target=${TARGET_ARCH}
RUN chmod +x seda-overlay

ENTRYPOINT ["./seda-overlay"]
CMD ["run", "--network", "${NETWORK_NAME}"]
