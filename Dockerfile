# Plonktris API server: one small static-ish binary, no OpenSSL (sqlx uses rustls).
# Host-agnostic: needs DATABASE_URL (+ optional ALLOWED_ORIGINS) and listens on $PORT.

# builder and runtime must share a Debian release (glibc)
FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# Build dependencies first against a stub main, so code-only changes reuse this layer.
COPY Cargo.toml Cargo.lock ./
COPY crates/server/Cargo.toml crates/server/Cargo.toml
RUN mkdir -p crates/server/src \
    && echo 'fn main() {}' > crates/server/src/main.rs \
    && cargo build --release -p plonktris-server \
    && rm -rf crates/server/src

# sqlx checks queries at compile time against the committed offline cache (.sqlx/)
COPY .sqlx .sqlx
COPY crates/server crates/server
ENV SQLX_OFFLINE=true
RUN touch crates/server/src/main.rs && cargo build --release -p plonktris-server

# distroless/cc: glibc + libgcc + CA certs, nothing else (~25MB)
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/plonktris-server /usr/local/bin/plonktris-server
ENV PORT=3000
EXPOSE 3000
CMD ["plonktris-server"]
