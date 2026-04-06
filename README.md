# IoT Telemetry Platform with Real-Time Anomaly Detection

Distributed system for collecting IoT telemetry, detecting anomalies with machine learning, and surfacing alerts through a web dashboard. Built as a personal project to work through the real complexity of event-driven distributed systems end-to-end.

**Stack:** Java 21 / Spring Boot 3.4.1 · Apache Kafka · Python 3.11 / FastAPI · Angular 17 · Docker

---

## Architecture

9 Spring Boot microservices + a Python ML platform + Angular frontend, all wired together through Kafka and orchestrated with a single `docker-compose.yml`.

```
Device Simulator
      ↓ HTTP + JWT
  API Gateway (8080)
      ↓
Ingestion Service → Kafka [device-data-received]
      ↓
Processing Service → Kafka [device-data-processed]
      ↓                          ↓                    ↓
Alert Service            ML Platform (Python)    Analytics Service
(PostgreSQL)             (Isolation Forest)      (Redis cache)
      ↓                          ↓
  Angular Frontend        Kafka [ml-predictions]
```

| Service | Port | Role |
|---------|------|------|
| gateway-service | 8080 | Entry point — JWT validation, routing, rate limiting |
| discovery-service | 8761 | Eureka service registry |
| auth-service | — | User registration, JWT generation |
| device-service | — | Device CRUD and metadata |
| ingestion-service | — | Telemetry intake, Kafka producer |
| processing-service | — | Event enrichment, rule evaluation |
| alert-service | — | Alert persistence and management |
| analytics-service | — | Historical stats, Redis-cached aggregations |
| notification-service | — | Webhook/email triggers |
| iot-ml-platform | 8000 | FastAPI ML server — anomaly scoring, model training |
| frontend | 4200 | Angular dashboard |

Kafka topics: `device-data-received` → `device-data-processed` → `ml-predictions`, `alert-created`

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

### ML prediction

```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "sensor-01",
    "timestamp": "2026-04-03T12:00:00Z",
    "enrichedData": {"temperature": 95.0, "humidity": 10.0, "vibration": 8.0}
  }'
```

Full Postman collection (40+ requests) in `postman/`.

---

## ML system

**Model:** Isolation Forest — unsupervised, no labeled data required.

**Features (24):** Raw sensor readings (`temperature`, `humidity`, `vibration`, `deviceType`) plus per-device rolling statistics over a 5-event window: mean, std, min, max, delta.

**Threshold:** Computed from the training score distribution (5th percentile), stored in `ml/models/latest_model.json`. Approximately `-0.036` on the current model.

**Retrain:** `POST http://localhost:8000/train`

**Inference:** Before scoring, the predictor fetches the last 4 stored events for the device from the Parquet data lake and prepends them to the current event. This gives the feature extractor a proper temporal window, so rolling statistics are non-degenerate and match the training distribution. Works identically for the Kafka streaming path and the REST API.

More detail in [`docs/ml.md`](docs/ml.md).

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
├── frontend/                    # Angular 17 dashboard
├── docs/                        # Architecture and API reference
├── postman/                     # API collection + environment
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
