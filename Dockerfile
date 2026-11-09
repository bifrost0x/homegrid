# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-bookworm@sha256:dc0963f32053e4bc451d24d87e3892d42d01021b61f093e98eb95c0352bb84b0 AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/ ./web/
COPY --from=frontend /src/web/dist ./web/dist
RUN go test ./... && go vet ./...
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=0.1.0
ARG COMMIT=local
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o /out/homegrid ./cmd/homegrid
RUN mkdir -p /out/data && chown 65532:65532 /out/data

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
ARG VERSION=0.1.0
ARG COMMIT=local
LABEL org.opencontainers.image.title="HomeGrid" \
      org.opencontainers.image.description="Your services. Beautifully organized." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/bifrost0x/homegrid"
WORKDIR /
COPY LICENSE /LICENSE
COPY --from=backend /out/homegrid /homegrid
COPY --from=backend --chown=65532:65532 /out/data /data
ENV HOMEGRID_LISTEN=0.0.0.0:8080 HOMEGRID_DATA_DIR=/data
USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/homegrid", "healthcheck"]
ENTRYPOINT ["/homegrid"]
