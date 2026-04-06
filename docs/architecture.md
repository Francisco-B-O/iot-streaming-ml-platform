# Architecture

## Services

19 containers orchestrated by a single `docker-compose.yml` at the project root.

### Spring microservices (`spring-event-iot-platform/`)

Multi-module Maven project. Java 21, Spring Boot 3.4.1.

| Service | Port | Role |
|---------|------|------|
| gateway-service | 8080 | Single ingress point. JWT validation, routing via Eureka |
| discovery-service | 8761 | Eureka registry. All Spring services register here on startup |
| auth-service | 8088 (internal) | Login, registration, JWT issuance |
| ingestion-service | internal | Receives telemetry POSTs, publishes to `device-data-received` |
| processing-service | internal | Consumes `device-data-received`, enriches events, publishes to `device-data-processed` |
| device-service | internal | Device CRUD backed by PostgreSQL |
| alert-service | internal | Consumes `device-data-processed`, applies thresholds, writes alerts to PostgreSQL |
| analytics-service | internal | Consumes `device-data-received`, increments Redis counters per device |
| notification-service | internal | Consumes `alert-created`, handles notification delivery |

"Internal" means `expose` only (not `ports`) in docker-compose.yml — reachable within the Docker network, not from the host.

### Python ML platform (`iot-ml-platform/`)

Python 3.11. FastAPI (port 8000) + Kafka consumer.

| Component | Description |
|-----------|-------------|
| `api/app.py` | FastAPI server: `/health`, `/predict`, `/predict/batch`, `/train`, `/stats` |
| `ingestion/kafka_consumer.py` | Consumes `device-data-processed`, scores each event, publishes to `ml-predictions` / `ml-anomalies` |
| `ml/` | Isolation Forest training and prediction logic |
| `processing/` | Feature engineering (rolling stats, deltas) |
| `storage/` | Parquet data lake, partitioned by day |

### Frontend (`frontend/`)

Angular 17, served by nginx in Docker. Port 4200.

### Infrastructure

| Container | Port | Role |
|-----------|------|------|
| kafka | 9092 (ext), 29092 (int) | Message broker |
| zookeeper | internal | Kafka coordination |
| postgres | internal | Shared PostgreSQL instance (3 databases/schemas) |
| redis | internal | Analytics event counters |
| zipkin | 9411 | Distributed tracing |
| prometheus | 9090 | Metrics scraping |
| grafana | 3000 | Dashboards (admin/admin) |

---

## Network

All containers are on a single Docker bridge network (`iot-network`). Inter-service communication uses container names as hostnames (e.g. `kafka:29092`, `postgres:5432`, `discovery-service:8761`).

Eureka is used for Spring service-to-service discovery — services register at startup and resolve each other by service name (e.g. `http://device-service/`).

Services are split into two exposure categories:
- **Public** (bound to host ports): gateway (8080), discovery (8761), ML API (8000), frontend (4200), monitoring (3000, 9090, 9411)
- **Internal** (Docker network only): everything else

---

## Authentication

JWT HS256. The `auth-service` issues tokens; the `gateway-service` validates them on every inbound request using the same `JWT_SECRET` env variable. Both services must share this value.

Endpoints excluded from auth in the gateway:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `/actuator/**`

Tokens expire in 24 hours (`expiresIn: 86400`).

---

## Storage

| Store | Used by | Content |
|-------|---------|---------|
| PostgreSQL | auth-service, device-service, processing-service, alert-service | Users, devices, processed events, alerts |
| Redis | analytics-service | Per-device event counters |
| Parquet files | iot-ml-platform | Raw telemetry events, partitioned by day (`data/raw/day=YYYY-MM-DD/`) |
| Model files | iot-ml-platform | Trained Isolation Forest joblib + metadata JSON (`ml/models/`) |

Schema management: `spring.jpa.hibernate.ddl-auto: update` — tables are created/updated automatically on service startup. No migration tool.

---

## Observability

**Tracing** — Micrometer + Zipkin. All Spring services send spans to `http://zipkin:9411`. View at `http://localhost:9411`.

**Metrics** — Prometheus scrapes `/actuator/prometheus` from every Spring service every 15 seconds. Config: `infrastructure/monitoring/prometheus.yml`. Grafana at `http://localhost:3000` (admin/admin).

**Logging** — standard stdout via `docker compose logs`.

---

## Scalability notes

The current setup is single-host Docker Compose. For production:
- Kafka consumer group IDs are set per service — scaling any consumer horizontally would work with Kafka's partition assignment
- Redis is single-node; analytics counters would need Redis Cluster for high write throughput
- PostgreSQL is shared across services in a single container — separate managed instances recommended per service in production
- The ML Kafka consumer has retry logic (30 attempts, 2s backoff) for subscription failures; the model is loaded once at startup and predictions are synchronous per event
