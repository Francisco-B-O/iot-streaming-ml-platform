# Postman Collection

API collection for the IoT platform with 40+ pre-built requests.

## Import

1. Open Postman → Import
2. Add `IoT-Platform-Collection.json`
3. Add `IoT-Platform-Environment.json`
4. Select "IoT Platform - Development" environment (top-right)

## Quick start

1. Run **1. AUTH → Login User** — the JWT token is saved automatically to `{{token}}`
2. All other requests use `Authorization: Bearer {{token}}`

## Collection structure

```
1. AUTH          — login, register
2. DEVICES       — CRUD operations
3. TELEMETRY     — send sensor data
4. ALERTS        — list, acknowledge, resolve
5. ANALYTICS     — historical stats
6. ML API        — predict, train, model info
7. HEALTH        — service health checks
8. WORKFLOWS     — end-to-end examples
```

## Environment variables

| Variable | Default |
|----------|---------|
| `base_url` | `http://localhost:8080` |
| `ml_url` | `http://localhost:8000` |
| `token` | auto-populated on login |
| `username` | `admin` |
| `password` | `admin123` |

## Prerequisites

All Docker services must be running (`docker compose up -d`):

```bash
curl http://localhost:8080/actuator/health
curl http://localhost:8000/health
```
