FROM oven/bun:1.2-alpine

ARG NETWORK_NAME=testnet

WORKDIR /app

COPY . .

# RUN bun install--frozen-lockfile
RUN bun install

# Build the seda-overlay executable from the cli package
# RUN bun build --compile --minify --sourcemap ./packages/cli/src/index.ts --outfile seda-overlay --target=${BUN_TARGET_ARCH}
# RUN chmod +x seda-overlay

RUN bun build --compile --minify --sourcemap ./packages/cli/src/index.ts \
    --outfile seda-overlay.js --target=node --external=ws

# RUN node ./seda-overlay init --network ${NETWORK_NAME}
RUN node ./seda-overlay.js init --network devnet

ENTRYPOINT ["node", "./seda-overlay.js"]
CMD ["run", "--network", "devnet"]
