FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/rt ./cmd/rt

FROM alpine:3.22
RUN adduser -D -H -u 10001 app
WORKDIR /app
COPY --from=build /out/rt /app/rt
USER app
ENV APP_ENV=production PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8090/healthz || exit 1
ENTRYPOINT ["/app/rt"]
