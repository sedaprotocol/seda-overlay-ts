FROM ubuntu:latest
WORKDIR /app

RUN apt update -y && apt install wget -y

RUN wget https://github.com/sedaprotocol/seda-overlay-ts/releases/download/v1.0.0-rc.10/seda-overlay-linux-x64

RUN chmod a+x seda-overlay-linux-x64

RUN ./seda-overlay-linux-x64 init --network testnet

ENTRYPOINT ["./seda-overlay-linux-x64"]
CMD ["run", "--network", "testnet"]
