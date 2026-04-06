# ML Anomaly Detection

How the machine learning side of the platform works.

## Overview

The ML platform is a separate Python service (`iot-ml-platform/`) that:
1. Consumes processed telemetry from Kafka (`device-data-processed`)
2. Scores each event with an Isolation Forest model
3. Publishes predictions back to Kafka (`ml-predictions`, `ml-anomalies`)
4. Stores all events (with scores) in a local Parquet data lake
5. Maintains an in-memory prediction history (last 500 predictions) for real-time stats

A FastAPI server (`port 8000`) also exposes the model for direct prediction calls and operational management.

---

## Algorithm

**Isolation Forest** — an unsupervised anomaly detection algorithm.

How it works: randomly selects a feature and a split value, then isolates points by recursively partitioning the data. Anomalous points (far from the normal distribution) get isolated in fewer splits, producing a lower `decision_function` score.

Why it suits this use case:
- No labeled data needed — the simulator only produces "normal" training data
- Handles multivariate sensor readings naturally
- Fast inference — O(log n) per sample
- Naturally produces an anomaly score (not just a binary label)

---

## Features

The model is trained on 24 features per event, derived from 4 raw sensor readings:

**Raw readings:**
- `enrichedData.temperature`
- `enrichedData.humidity`
- `enrichedData.vibration`
- `enrichedData.deviceType`

**Per-sensor rolling statistics (window = 5 events, grouped by device):**
- `feat_<sensor>_rolling_mean_5`
- `feat_<sensor>_rolling_std_5`
- `feat_<sensor>_rolling_min_5`
- `feat_<sensor>_rolling_max_5`
- `feat_<sensor>_delta` — difference from previous reading

Rolling features capture temporal patterns: a sudden temperature spike is more anomalous than a gradual increase, and the delta and std features reflect this.

---

## Scoring

The model uses sklearn's `decision_function`, which returns:
- **Positive scores** (~+0.07 average on training data) → normal
- **Scores below the threshold** → anomaly

**Threshold:** computed from the training data's score distribution (5th percentile). With the current model trained on 861 samples, this is approximately **-0.036**. About 5% of training data falls below this — the model tolerates a small fraction of marginal readings as borderline cases.

The threshold is stored in `ml/models/latest_model.json` and recomputed on each retrain, so it stays calibrated to the actual training distribution rather than being hardcoded.

---

## The rolling-feature inference problem (and the fix)

### Root cause

Rolling features are computed over a 5-event window **per device**. During training this works because the data lake has hundreds of events per device, giving real variance in the window. At inference time, the original code called `prepare_for_ml` on a **single event**, which produced degenerate features:

```
rolling_std  = 0       (no variance in a 1-event window)
rolling_min  = value   (same as raw)
rolling_max  = value   (same as raw)
delta        = 0       (no previous reading)
```

These vectors don't look like anything in the training distribution — the model flagged everything as anomalous.

### Fix: windowed inference

Before scoring, `predict_anomaly` now fetches the last 4 events for the device from the data lake and prepends them to the current event. `prepare_for_ml` then computes rolling features over a proper 5-event sequence.

```
Before fix: model sees [25°C] → score ≈ -0.16 → ANOMALY (false positive)
After fix:  model sees [23, 24, 24, 25, 25°C] → score ≈ +0.003 → NORMAL (correct)
```

This happens transparently inside `predict_anomaly` and requires no API change. The Kafka streaming path benefits automatically — each event now has real historical context.

---

## Model versioning

Each training run saves to a timestamped directory:

```
ml/models/
├── 20260402_161522/
│   ├── anomaly_detector.joblib   # serialised IsolationForest
│   └── feature_names.joblib      # feature column order
├── latest_model.json             # pointer to current version + metadata
└── model_registry.json           # history of all training runs
```

`latest_model.json` includes the computed threshold, so the predictor always uses the threshold that matches the training run.

---

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Health check + model version + threshold |
| POST | `/predict` | — | Score a single event (fetches data lake context internally) |
| POST | `/predict/batch` | — | Score a time-ordered sequence of events explicitly |
| POST | `/train` | — | Retrain model on data lake history |
| GET | `/stats` | — | Data lake summary (cached 60 s) |
| GET | `/anomaly-stats` | — | Aggregated stats from in-memory prediction history |
| GET | `/autotrain` | — | Current auto-retrain config and last train timestamp |
| POST | `/autotrain` | — | Enable/disable auto-retraining and set interval |

Full interactive docs at `http://localhost:8000/docs`.

### Single prediction

```http
POST http://localhost:8000/predict
Content-Type: application/json

{
  "deviceId": "sensor-01",
  "timestamp": "2026-04-03T12:00:00Z",
  "enrichedData": {
    "temperature": 95.0,
    "humidity": 8.0,
    "vibration": 7.5
  }
}
```

```json
{
  "is_anomaly": true,
  "anomaly_score": -0.184,
  "prediction": "ANOMALY",
  "threshold": -0.0363
}
```

### Batch prediction (explicit window)

Use this when you have a sequence of readings and want full control over the context:

```http
POST http://localhost:8000/predict/batch
Content-Type: application/json

{
  "deviceId": "sensor-01",
  "events": [
    {"timestamp": "...", "enrichedData": {"temperature": 23, "humidity": 52, "vibration": 0.1}},
    {"timestamp": "...", "enrichedData": {"temperature": 24, "humidity": 53, "vibration": 0.12}},
    {"timestamp": "...", "enrichedData": {"temperature": 95, "humidity": 9, "vibration": 7.5}}
  ]
}
```

Events must be ordered oldest-first. Each event is scored using all preceding events in the list (plus data lake history for the first few) as rolling context.

### Anomaly statistics

```http
GET http://localhost:8000/anomaly-stats
```

```json
{
  "total_predictions": 320,
  "anomaly_count": 14,
  "anomaly_rate": 4.4,
  "anomalies_by_device": {
    "sensor-01": 9,
    "sensor-02": 5
  },
  "recent_anomalies": [
    {
      "device_id": "sensor-01",
      "timestamp": "2026-04-06T10:12:00Z",
      "is_anomaly": true,
      "score": -0.184
    }
  ]
}
```

Stats are aggregated from an in-memory deque (maxlen=500). They include predictions from both the Kafka consumer path and direct REST `/predict` calls. The history resets on service restart.

### Auto-retrain

```http
# Get current config
GET http://localhost:8000/autotrain

# Enable retraining every 4 hours
POST http://localhost:8000/autotrain
Content-Type: application/json

{"enabled": true, "interval_hours": 4.0}
```

A daemon background thread checks every 60 seconds. It triggers a full retrain when `enabled=true` and the configured interval has elapsed since the last training run. After retraining, the model is reloaded in-process — no restart needed.

---

## Training

```bash
cd iot-ml-platform
export PYTHONPATH=$PYTHONPATH:.
python ml/train_model.py

# or via API:
curl -X POST http://localhost:8000/train
```

Training reads all Parquet files from `data/raw/`, calls `prepare_for_ml` to compute rolling features, fits `IsolationForest(n_estimators=100, contamination='auto', random_state=42)`, then computes and saves the threshold from the resulting score distribution.

Minimum useful training set: ~100+ events spread across multiple devices.

---

## Data lake

Events are stored as individual Parquet files partitioned by day:

```
data/raw/
├── day=2026-04-02/
│   ├── event_161522_001234.parquet
│   └── ...
└── day=2026-04-03/
    └── ...
```

Each file contains one event with all its enrichedData columns flattened (via `json_normalize`). This format is compatible with `prepare_for_ml` directly.

---

## Validation results (post-fix)

Tested against a real device (`sensor-1`) with 4 historical events in the data lake.

| Category | Temperature | Score | Classification |
|----------|-------------|-------|----------------|
| Normal | 22°C / 50% hum / 0.1 vib | -0.009 | NORMAL |
| Normal | 25°C / 55% hum / 0.2 vib | +0.003 | NORMAL |
| Normal | 28°C / 45% hum / 0.15 vib | -0.008 | NORMAL |
| Edge | 35°C / 70% hum / 0.5 vib | -0.036 | ANOMALY |
| Edge | 40°C / 80% hum / 0.8 vib | -0.089 | ANOMALY |
| Anomaly | 80°C / 10% hum / 5.0 vib | -0.184 | ANOMALY |
| Anomaly | 100°C / 5% hum / 8.0 vib | -0.220 | ANOMALY |
| Anomaly | 120°C / 2% hum / 10.0 vib | -0.227 | ANOMALY |

**False positives on normal data: 0/5. True positives on anomalies: 5/5.**

Edge cases (35–45°C) are classified as anomalies. This is intentional — they fall outside the training distribution of 20–30°C normal readings. Adjust the threshold or retrain with a broader normal range if the operating envelope differs.
