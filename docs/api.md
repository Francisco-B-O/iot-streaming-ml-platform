# API Reference

Base URL for all Spring endpoints: `http://localhost:8080/api/v1`

All endpoints except auth require `Authorization: Bearer <token>`.

---

## Authentication

### Login
```http
POST /auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 86400
}
```

### Register
```http
POST /auth/register
Content-Type: application/json

{
  "username": "newuser",
  "password": "securepass123"
}
```

---

## Devices

### List
```http
GET /devices
Authorization: Bearer {token}
```

### Create
```http
POST /devices
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Main Sensor",
  "type": "TEMPERATURE",
  "location": "Building A"
}
```

### Get
```http
GET /devices/{id}
Authorization: Bearer {token}
```

### Update
```http
PUT /devices/{id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Updated Name",
  "status": "ACTIVE"
}
```

### Delete
```http
DELETE /devices/{id}
Authorization: Bearer {token}
```

---

## Telemetry

### Submit
```http
POST /telemetry
Authorization: Bearer {token}
Content-Type: application/json

{
  "deviceId": "sensor-1",
  "payload": {
    "temperature": 23.5,
    "humidity": 45.2,
    "vibration": 0.02
  }
}
```

---

## Alerts

### List
```http
GET /alerts
Authorization: Bearer {token}
```

Query params: `status` (OPEN, ACKNOWLEDGED, RESOLVED), `severity` (CRITICAL, HIGH, MEDIUM, LOW)

### Get
```http
GET /alerts/{id}
Authorization: Bearer {token}
```

### Acknowledge
```http
PUT /alerts/{id}/acknowledge
Authorization: Bearer {token}
```

---

## Analytics

### System summary
```http
GET /analytics
Authorization: Bearer {token}
```

### Per device
```http
GET /analytics/{deviceId}
Authorization: Bearer {token}
```

---

## ML API — port 8000

Interactive docs at `http://localhost:8000/docs`.

### Health
```http
GET http://localhost:8000/health
```
```json
{
  "status": "healthy",
  "model_version": "20260402_161522",
  "threshold": -0.0363
}
```

### Single prediction
```http
POST http://localhost:8000/predict
Content-Type: application/json

{
  "deviceId": "sensor-01",
  "timestamp": "2026-04-03T12:00:00Z",
  "enrichedData": {
    "temperature": 95.0,
    "humidity": 10.0,
    "vibration": 8.0
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

### Batch prediction
```http
POST http://localhost:8000/predict/batch
Content-Type: application/json

{
  "deviceId": "sensor-01",
  "events": [
    {"timestamp": "2026-04-03T12:00:00Z", "enrichedData": {"temperature": 23, "humidity": 52, "vibration": 0.1}},
    {"timestamp": "2026-04-03T12:01:00Z", "enrichedData": {"temperature": 24, "humidity": 53, "vibration": 0.12}},
    {"timestamp": "2026-04-03T12:02:00Z", "enrichedData": {"temperature": 95, "humidity": 9,  "vibration": 7.5}}
  ]
}
```

Events must be oldest-first. Returns one result per event.

### Retrain model
```http
POST http://localhost:8000/train
```

### Data lake stats
```http
GET http://localhost:8000/stats
```

---

## Error codes

| Code | Meaning |
|------|---------|
| 401 | Missing or invalid JWT |
| 403 | Insufficient role |
| 404 | Resource not found |
| 429 | Rate limited |
| 500 | Server error |
