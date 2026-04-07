# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
# Build and start everything
docker compose build --no-cache
docker compose up -d

# Health check
curl http://localhost:8761/eureka/apps

# First login
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## Architecture Overview

This is a distributed IoT telemetry platform with three sub-systems:

**Spring Microservices** (`spring-event-iot-platform/`) — 9 Java services organized as a multi-module Maven project. The event-driven data path is:

```
Device Simulator → API Gateway (8080) → Ingestion Service → Kafka
  → Processing Service → Kafka → Alert Service → PostgreSQL
                       → ML Platform (8000) → Predictions back to Kafka
```

**ML Platform** (`iot-ml-platform/`) — Python 3.11 with FastAPI (port 8000) and a Kafka consumer that feeds an Isolation Forest model for anomaly detection. Model is trained on historical Parquet files in `data/`.

**Frontend** (`frontend/`) — Angular 17 dashboard at port 4200 consuming the API Gateway.

**Infrastructure**: Single `docker-compose.yml` at root orchestrates all 19 containers (Zookeeper, Kafka, PostgreSQL, Redis, Zipkin, Prometheus, Grafana, all services, simulator, ML platform, and frontend).

### Kafka Topics

| Topic | Producer | Consumers |
|-------|----------|-----------|
| `device-data-received` | ingestion-service | processing-service, analytics-service |
| `device-data-processed` | processing-service | alert-service, analytics-service, ml-platform |
| `alert-created` | alert-service | notification-service |
| `ml-predictions` | ml-platform | (frontend polling) |

### Service Ports

| Service | Port | Purpose |
|---------|------|---------|
| gateway-service | 8080 | All external traffic goes here |
| discovery-service | 8761 | Eureka dashboard |
| auth-service | 8088 | Internal only (via gateway) |
| iot-ml-platform | 8000 | ML API |
| frontend | 4200 | Angular app |
| Grafana | 3000 | admin/admin |
| Prometheus | 9090 | Metrics |
| Zipkin | 9411 | Distributed tracing |

## Build Commands

### Java Services (Maven, Java 21, Spring Boot 3.4.1)

```bash
cd spring-event-iot-platform

# Build all modules
mvn clean package -DskipTests

# Build a single service (with its dependencies)
mvn clean package -DskipTests --projects services/processing-service --also-make

# Run tests for all modules
mvn test

# Run tests for a single module
cd services/alert-service && mvn test

# Run a single test class
mvn test -Dtest=AlertServiceTest

# Run a single test method
mvn test -Dtest=AlertServiceTest#testCreateAlert
```

### Angular Frontend

```bash
cd frontend
npm install
npm start          # Dev server on port 4200
npm run build      # Production build
npm test           # Karma/Jasmine unit tests
```

### Python ML Platform

```bash
cd iot-ml-platform
pip install -r requirements.txt

export PYTHONPATH=$PYTHONPATH:.
python ingestion/kafka_consumer.py   # Start Kafka consumer (background)
python api/app.py                    # FastAPI on port 8000
python ml/train_model.py             # Train/retrain model
pytest                               # Run tests
```

## Key Configuration Patterns

**Environment variables** — All hardcoded values replaced with `${VAR_NAME:default}` pattern. Defaults are set for local Docker deployment; override via `.env` or shell environment for production.

**Service discovery** — All Spring services register with Eureka at `http://discovery-service:8761/eureka/`. Inter-service calls use service names (e.g., `http://device-service/`) resolved by Eureka.

**JWT** — HS256 algorithm. Secret: `JWT_SECRET` env var (same in auth-service and gateway). Gateway validates all requests except `/api/v1/auth/**` and `/actuator/**`.

**Database migrations** — Using `spring.jpa.hibernate.ddl-auto: update`. No Flyway/Liquibase. Three services use PostgreSQL: auth-service, device-service, processing-service.

**Kafka internal address** — Services communicate on `kafka:29092` (internal Docker network). External access is on port `9092`.

## Common Lib

`spring-event-iot-platform/common/common-lib` is a shared Maven module containing:
- DTOs (request/response objects)
- Custom exceptions
- MapStruct mappers

All services depend on it. Changes here require rebuilding dependent services.

## Network Isolation

Internal services use `expose` (not `ports`) in docker-compose.yml — they are only accessible within the Docker network. Only the gateway (8080), discovery (8761), ML API (8000), frontend (4200), and monitoring tools are bound to host ports.

## Observability

- **Tracing**: Zipkin at port 9411. All Spring services send spans via Micrometer.
- **Metrics**: Prometheus scrapes `/actuator/prometheus` every 15s from all services. Config: `infrastructure/monitoring/prometheus.yml`.
- **Dashboards**: Grafana at port 3000.

## Analytics Service — Redis Keys

The analytics-service stores three types of data in Redis per device:

| Key pattern | Value | Description |
|-------------|-------|-------------|
| `analytics:event-count:{deviceId}` | integer string | Cumulative telemetry event count |
| `analytics:last-seen:{deviceId}` | epoch ms string | Timestamp of last telemetry received |
| `analytics:history:{deviceId}` | Redis list (max 50) | JSON snapshots `{ts, temperature, humidity, vibration}` |

New endpoints exposed via gateway (`/api/v1/analytics`):

| Endpoint | Description |
|----------|-------------|
| `GET /stats/{deviceId}` | Returns `eventCount` + `lastSeen` (epoch ms) |
| `GET /history/{deviceId}` | Returns last 50 telemetry snapshots, newest first |

The `AnalyticsDto` now includes a `lastSeen` field (Long, nullable). The frontend uses this to derive online/offline status (threshold: last seen within 2 minutes).

## ML Platform — Additional Endpoints

New endpoints in `iot-ml-platform/api/app.py`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/anomaly-stats` | GET | Aggregated stats from in-memory prediction history (rate, count by device, recent anomalies) |
| `/autotrain` | GET | Current auto-retrain schedule config |
| `/autotrain` | POST | Set `enabled` (bool) + `interval_hours` (float). Background thread retries every minute. |

The prediction history is an in-memory `deque(maxlen=500)` — it resets on service restart. The auto-retrain background thread is started as a daemon thread on app startup.

## Processing Service — Alert Rules

Temperature threshold is configurable at runtime without restarting the service:

```bash
# Get current threshold
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/rules/temperature

# Update threshold (e.g. set critical at 90°C, warning at 72°C = 90*0.8)
curl -X POST http://localhost:8080/api/v1/rules/temperature \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 90}'
```

Alert logic in `TelemetryListener`: `temp > threshold` → CRITICAL, `temp > threshold * 0.8` → WARNING.

## Frontend — Feature Overview

| Section | Key features |
|---------|-------------|
| **Dashboard** | KPIs, alert severity chart, recent alerts, 15s auto-refresh |
| **Devices** | CRUD, telemetry modal, **Online/Offline live badge** (2-min window), Last Seen column |
| **Telemetry** | Manual sensor input with sliders and presets |
| **Alerts** | Severity/status filters, bulk ack, **Export CSV**, **Alert Rules panel** (threshold editor) |
| **Analytics** | Event counts, bar chart, **Telemetry History line chart** (temp/humidity/vibration tabs) |
| **ML Platform** | Prediction tester, **Anomaly stats KPIs**, **Recent anomalies list**, retrain, **Auto-retrain toggle** |
| **Health** | Gateway, ML, Discovery status |
| **Topbar** | **Notification bell** with badge + dropdown of pending alerts |

## Testing the Full Flow

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# 2. Register a device
curl -X POST http://localhost:8080/api/v1/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"sensor-01","type":"TEMPERATURE","location":"Building A"}'

# 3. The device-simulator auto-starts and sends telemetry with JWT
# Monitor data flow in Kafka, then check alerts:
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/alerts

# 4. Check telemetry history for a device
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/analytics/history/sensor-01

# 5. Check ML anomaly stats
curl http://localhost:8000/anomaly-stats

# 6. Enable auto-retraining every 4 hours
curl -X POST http://localhost:8000/autotrain \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "interval_hours": 4}'
```

See `postman/` directory for a complete Postman collection with 40+ pre-built requests.

## Geospatial System

The platform includes a full geospatial monitoring layer using **Leaflet + OpenStreetMap** (free/OSS only).

### Device GPS

Devices can have `latitude` and `longitude` fields (nullable `DOUBLE PRECISION`). Set coordinates when creating or updating a device:

```bash
curl -X POST http://localhost:8080/api/v1/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"sensor-01","type":"TEMPERATURE","simulated":false,"latitude":40.4168,"longitude":-3.7038}'
```

### Area Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/api/v1/areas` | List all areas with device membership |
| `POST`  | `/api/v1/areas` | Create area `{ name, polygon: [[lat,lng],...] }` (min 3 points) |
| `PATCH` | `/api/v1/areas/{id}/polygon` | Update polygon of existing area |
| `DELETE`| `/api/v1/areas/{id}` | Delete area (cascades join table) |
| `POST`  | `/api/v1/areas/{id}/devices/{deviceId}` | Assign device to area (idempotent) |
| `GET`   | `/api/v1/devices/map` | Lightweight device list for map rendering |

All area endpoints are routed through the gateway (`lb://device-service`).

### Map Frontend (Angular)

Navigate to **Map** in the left sidebar (icon: `map`). Features:

| Feature | Description |
|---------|-------------|
| **Device markers** | Colored circles: green=normal, yellow=anomaly score>0.3, red=anomaly, gray=offline, blue=no GPS |
| **Popups** | Click a marker → shows deviceId, last temperature (lazy-loaded), anomaly status, area, score |
| **Draw areas** | Click "Draw new area" → draw polygon on map → enter name → Save |
| **Edit areas** | Use the Leaflet.draw edit toolbar to reshape existing polygon → auto-saved via PATCH |
| **Delete areas** | Trash icon next to area in left panel (with confirm dialog) |
| **Heatmap** | Toggle "Temperature heatmap" — intensity driven by ML anomaly score (0.15 baseline → 1.0 anomaly) |
| **High-risk areas** | Areas containing anomaly devices render in red with "⚠ anomalies detected" tooltip |
| **Filters** | Filter markers by area membership or severity (normal/anomaly) |
| **No-GPS count** | Devices without coordinates shown in stats chip (not rendered on map) |

### Database Schema (V3 migration)

```sql
ALTER TABLE devices ADD COLUMN latitude  DOUBLE PRECISION;
ALTER TABLE devices ADD COLUMN longitude DOUBLE PRECISION;

CREATE TABLE areas (
  id         UUID PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  polygon    TEXT NOT NULL,   -- JSON: [[lat,lng], ...]
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE area_devices (
  area_id   UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (area_id, device_id)
);
```

### Architecture Notes

- **Polygon storage**: JSON text column via `PolygonConverter` (JPA `AttributeConverter`)
- **N+1 avoidance**: `findAllWithDevices()` uses `LEFT JOIN FETCH`; `getDevicesForMap()` builds an in-memory device→area lookup in 2 queries
- **Temperature in popups**: fetched lazily from `GET /analytics/history/{deviceId}` on first popup open, then cached in-memory
- **Edit persistence**: `draw:edited` event sends `PATCH /api/v1/areas/{id}/polygon` per modified layer
