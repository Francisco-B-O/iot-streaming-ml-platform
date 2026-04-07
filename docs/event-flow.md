# Event Flow

End-to-end path from a sensor reading entering the system to alerts and ML predictions being available.

## Overview

```
Device / Dashboard
       │  POST /api/v1/telemetry (JWT)
       ▼
  API Gateway :8080
       │  routes to ingestion-service via Eureka
       ▼
  ingestion-service
       │  publishes to Kafka
       ▼
  [Kafka: device-data-received]
       │
       ├─────────────────────────────┐
       ▼                             ▼
  processing-service          analytics-service
       │ alert rules eval           │ Redis counters + history
       │ persists to PostgreSQL     │
       │ publishes to Kafka         │
       ▼
  [Kafka: device-data-processed]
       │
       ├──────────────────────────────────────────┐
       ▼                                          ▼
  alert-service                       spark-streaming-service
       │ threshold check               rolling window features
       │ creates alert                       (20-event window)
       ▼                                          │
  [PostgreSQL]                                    ▼
       │                              [Kafka: device-data-enriched]
       ▼                                          │
  [alert-created]                                 ▼
       │                                  iot-ml-platform (Python)
       ▼                               ensemble: IF + Z-score + Trend
  notification-service                           │
                                     ┌───────────┴──────────┐
                                     ▼                      ▼
                             [ml-predictions]         [ml-anomalies]
```

## Step by step

### 1. Telemetry ingestion

A reading enters through `POST /api/v1/telemetry` at the API Gateway. The gateway validates the JWT and forwards the request to `ingestion-service` using Eureka service discovery (URL: `http://ingestion-service/`).

The ingestion-service publishes the raw payload to the `device-data-received` Kafka topic (`kafka:29092` inside Docker).

### 2. Processing

The `processing-service` consumes `device-data-received`. It:
- Adds enrichment metadata (processing timestamp, derived fields)
- Writes the processed event to PostgreSQL
- Publishes the enriched event to `device-data-processed`

### 3. Parallel consumers of `device-data-processed`

Two services consume this topic directly:

**alert-service** — applies threshold rules to the sensor values. When a reading exceeds configured limits (e.g. temperature > 100°C), it creates an alert record in PostgreSQL and publishes an `alert-created` event to Kafka.

**spark-streaming-service** (PySpark) — computes rolling window features (mean, std, min, max, range, trend, event_count) over a 20-event per-device window using `DeviceWindowState`. Publishes enriched events to `device-data-enriched`.

**analytics-service** — also consumes `device-data-received` (in parallel with processing-service) and stores per-device event counters, last-seen timestamps, and telemetry history rings in Redis.

### 3b. ML inference from `device-data-enriched`

**iot-ml-platform** (Python Kafka consumer) — receives the Spark-enriched event and runs the multi-model ensemble (Isolation Forest + Z-score + Trend). Publishes the prediction result to `ml-predictions`; if anomalous, also publishes to `ml-anomalies`.

### 4. Notifications

The `notification-service` consumes `alert-created` and handles downstream notification delivery.

### 5. Device simulator

The `device-simulator` service starts automatically with the Docker Compose stack. It obtains a JWT at startup and periodically submits telemetry readings with bearer token authentication, driving the full pipeline without manual intervention.

---

## Kafka topics

| Topic | Producer | Consumers |
|-------|----------|-----------|
| `device-data-received` | ingestion-service | processing-service, analytics-service |
| `device-data-processed` | processing-service | alert-service, spark-streaming-service |
| `device-data-enriched` | spark-streaming-service | iot-ml-platform |
| `alert-created` | alert-service | notification-service |
| `ml-predictions` | iot-ml-platform | (frontend polling via ML API) |
| `ml-anomalies` | iot-ml-platform | — |

Internal Kafka address: `kafka:29092`. External access: `localhost:9092`.

---

## ML prediction path (detail)

When the Kafka consumer receives a `device-data-processed` event:

1. Event payload is stored to the Parquet data lake (`data/raw/day=YYYY-MM-DD/`)
2. `predict_anomaly()` calls `_build_inference_window()`:
   - Fetches last 4 events for the device from the data lake (newest Parquet files, capped at 300 files scanned)
   - Prepends them to the current event → 5-event window
3. `prepare_for_ml()` computes 24 features: raw values (temperature, humidity, vibration) + per-device rolling stats over the window (mean, std, min, max, delta)
4. Model scores the feature vector with `decision_function()`
5. Score < threshold (-0.0363) → anomaly; published to both `ml-predictions` and `ml-anomalies`
6. Score ≥ threshold → normal; published to `ml-predictions` only

The threshold is computed at training time as the 5th percentile of training scores and stored in `ml/models/latest_model.json`.
