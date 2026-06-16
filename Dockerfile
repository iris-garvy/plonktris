FROM rust:1-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV SQLX_OFFLINE=true
RUN cargo build --release -p plonktris-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/plonktris-server /usr/local/bin/plonktris-server

EXPOSE 3000
CMD ["plonktris-server"]
