# IoT Telemetry Platform with Real-Time Anomaly Detection

Distributed system for collecting IoT telemetry, detecting anomalies with machine learning, and surfacing alerts through a web dashboard. Built as a personal project to work through the real complexity of event-driven distributed systems end-to-end.

**Stack:** Java 21 / Spring Boot 3.4.1 · Apache Kafka · Python 3.11 / FastAPI · Angular 17 · Docker

---

## Architecture

9 Spring Boot microservices + a Python ML platform + a PySpark streaming service + Angular frontend, all wired together through Kafka and orchestrated with a single `docker-compose.yml`.

```
Device Simulator
      ↓ HTTP + JWT
  API Gateway (8080)
      ↓
Ingestion Service → Kafka [device-data-received]
      ↓                          ↓
Processing Service         Analytics Service
      ↓                     (Redis cache)
Kafka [device-data-processed]
      ↓                    ↓
Alert Service       Spark Streaming Service
(PostgreSQL)        (rolling window features)
                           ↓
                    Kafka [device-data-enriched]
                           ↓
                    ML Platform (Python)
                    (IF + Z-score + Trend ensemble)
                           ↓
                    Kafka [ml-predictions]
```

| Service | Port | Role |
|---------|------|------|
| gateway-service | 8080 | Entry point — JWT validation, routing, rate limiting |
| discovery-service | 8761 | Eureka service registry |
| auth-service | — | User registration, JWT generation |
| device-service | — | Device CRUD, GPS coordinates, area management |
| ingestion-service | — | Telemetry intake, Kafka producer |
| processing-service | — | Event enrichment, configurable alert rule evaluation |
| alert-service | — | Alert persistence and management |
| analytics-service | — | Per-device event counts, last-seen timestamps, telemetry history (Redis) |
| notification-service | — | Webhook/email triggers |
| spark-streaming-service | — | PySpark rolling window feature engineering |
| iot-ml-platform | 8000 | FastAPI ML server — ensemble anomaly detection, model training, real-time stats |
| frontend | 4200 | Angular dashboard |

Kafka topics: `device-data-received` → `device-data-processed` → `device-data-enriched` → `ml-predictions`, `ml-anomalies`, `alert-created`

---

## Running it

### Requirements

- Docker + Docker Compose
- ~6 GB RAM
- Ports available: `8080`, `4200`, `8000`, `8761`, `3000`, `9090`, `9411`

### Start

```bash
docker compose build --no-cache
docker compose up -d
```

All services register with Eureka in ~60–90 seconds. Check status:

```bash
docker compose ps
curl http://localhost:8761/eureka/apps
```

### Access

| What | URL | Credentials |
|------|-----|-------------|
| Frontend | http://localhost:4200 | admin / admin123 |
| ML API docs | http://localhost:8000/docs | — |
| Eureka | http://localhost:8761 | — |
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Zipkin | http://localhost:9411 | — |

---

## API

### Authenticate

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')
```

### Register a device

```bash
curl -X POST http://localhost:8080/api/v1/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"sensor-01","type":"TEMPERATURE","location":"Building A"}'
```

### Send telemetry

```bash
curl -X POST http://localhost:8080/api/v1/telemetry \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"sensor-01","payload":{"temperature":25.5,"humidity":55.0,"vibration":0.2}}'
```

### Check alerts

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/alerts | jq
```

### Device analytics (event count + last seen)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/analytics/stats/sensor-01

# Telemetry history (last 50 snapshots)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/analytics/history/sensor-01
```

### Configure alert threshold

```bash
# Get current threshold
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/rules/temperature

# Update threshold (e.g. 90°C critical, 72°C warning)
curl -X POST http://localhost:8080/api/v1/rules/temperature \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 90}'
```

### ML prediction and stats

```bash
# Single prediction
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "sensor-01",
    "timestamp": "2026-04-03T12:00:00Z",
    "enrichedData": {"temperature": 95.0, "humidity": 10.0, "vibration": 8.0}
  }'

# Anomaly stats
curl http://localhost:8000/anomaly-stats

# Enable auto-retraining every 4 hours
curl -X POST http://localhost:8000/autotrain \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "interval_hours": 4}'
```

Full Postman collection (50+ requests) in `postman/`.

---

## ML system

**Ensemble:** Three models vote on each event — Isolation Forest (weight 2), Z-score (weight 1), Trend (weight 1). An anomaly is declared when total weighted votes ≥ 2.

| Model | Detects |
|-------|---------|
| Isolation Forest | Global statistical outliers (trained on historical Parquet data) |
| Z-score | Sensor readings deviating > 3σ from rolling mean (uses Spark features) |
| Trend | Increasing temperature trend with high variance (uses Spark features) |

**Isolation Forest features (24):** Raw sensor readings (`temperature`, `humidity`, `vibration`) plus per-device rolling statistics over a 5-event window: mean, std, min, max, delta.

**Threshold (IF):** Computed at training time as the 5th percentile of training scores, stored in `ml/models/latest_model.json`. Approximately `-0.036` on the current model.

**Retrain:** `POST http://localhost:8000/train` or via the dashboard ML section.

**Auto-retrain:** Enable via `POST http://localhost:8000/autotrain` with `{"enabled": true, "interval_hours": 4}`. A background daemon thread handles the schedule.

**Anomaly stats:** `GET http://localhost:8000/anomaly-stats` — real-time aggregates from the in-memory prediction history (last 500 predictions).

**Inference context:** Before Isolation Forest scoring, the predictor fetches the last 4 stored events for the device from the Parquet data lake and prepends them to the current event, providing a proper 5-event temporal window.

More detail in [`docs/ml.md`](docs/ml.md).

---

## Dashboard features

| Section | Key features |
|---------|-------------|
| **Dashboard** | KPIs, alert severity chart, recent alerts, 15 s auto-refresh |
| **Devices** | CRUD, telemetry modal, **Online/Offline live badge** (2-min window), **Last Seen** column, **GPS location picker** |
| **Telemetry** | Manual sensor input with sliders, presets, session history |
| **Alerts** | Severity/status filters, bulk ack, **Export CSV**, **Alert Rules panel** (runtime threshold editor) |
| **Analytics** | Event counts, bar chart, **Telemetry History line chart** (temp/humidity/vibration tabs) |
| **ML Platform** | Prediction tester, **Anomaly stats KPIs**, **Recent anomalies list**, retrain, **Auto-retrain toggle** |
| **Map** | Leaflet/OpenStreetMap map with color-coded device markers, draw/edit/delete area polygons, temperature heatmap, filters |
| **Health** | Gateway, ML, Discovery service status |
| **Topbar** | **Notification bell** with badge + dropdown of pending critical alerts |

---

## Project structure

```
.
├── spring-event-iot-platform/   # Java microservices (Maven multi-module)
│   ├── common/common-lib/       # Shared DTOs, exceptions, mappers
│   ├── services/                # 9 Spring Boot services
│   └── simulator/               # Device simulator
├── iot-ml-platform/             # Python ML platform
│   ├── api/                     # FastAPI server
│   ├── ingestion/               # Kafka consumer
│   ├── ml/                      # Model training and prediction
│   ├── processing/              # Feature engineering
│   ├── storage/                 # Parquet data lake
│   └── data/                    # Parquet files (partitioned by day)
├── spark-streaming-service/     # PySpark rolling window feature engineering
│   ├── streaming/               # Pure-Python feature logic + Spark processor
│   └── config/                  # Environment-based configuration
├── frontend/                    # Angular 17 dashboard
├── docs/                        # Architecture and API reference
├── postman/                     # API collection + environment
├── infrastructure/              # Prometheus config, Docker volumes
├── sonar-project.properties     # SonarQube analysis config
└── docker-compose.yml
```

---

## Development

### Java services

```bash
cd spring-event-iot-platform
mvn clean package -DskipTests

# Single service
mvn clean package -DskipTests --projects services/processing-service --also-make

# SonarQube analysis
mvn sonar:sonar -Dsonar.host.url=http://localhost:9000
```

### Python ML platform

```bash
cd iot-ml-platform
pip install -r requirements.txt
export PYTHONPATH=$PYTHONPATH:.

python ingestion/kafka_consumer.py   # Kafka consumer + ML pipeline
python api/app.py                    # FastAPI on :8000
python ml/train_model.py             # Retrain model
pytest                               # Tests
```

### Frontend

```bash
cd frontend
npm install
npm start   # http://localhost:4200
```

---

## Author

**Francisco Balonero Olivera**

- GitHub: https://github.com/Francisco-B-O
- LinkedIn: https://www.linkedin.com/in/francisco-balonero-olivera/

