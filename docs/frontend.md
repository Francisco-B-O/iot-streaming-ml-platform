# Frontend

Angular 17 dashboard at `http://localhost:4200`. Built as a single-page application using standalone components — no Angular Router. Navigation is handled entirely through conditional rendering in `app.component.ts`.

## Tech stack

| Package | Purpose |
|---------|---------|
| Angular 17 | Framework (standalone components, no NgModules) |
| Angular Material | UI primitives (icons, spinners, snackbar, tooltip, ripple) |
| ngx-charts | Charts (pie, bar-vertical, line) |
| RxJS | Async data, polling intervals, forkJoin |

## Project structure

```
frontend/src/app/
├── app.component.ts          # Shell: sidebar, topbar, auth gate, routing state, notification bell
├── components/
│   ├── login.component.ts    # Auth page
│   ├── dashboard.component.ts
│   ├── devices.component.ts
│   ├── telemetry.component.ts
│   ├── alerts.component.ts
│   ├── analytics.component.ts
│   ├── ml.component.ts
│   └── health.component.ts
└── services/
    ├── api.service.ts        # All HTTP calls to gateway (8080) and ML API (8000)
    ├── auth.service.ts       # JWT lifecycle, localStorage, BehaviorSubject
    └── telemetry.service.ts
```

## Navigation model

`AppComponent` maintains an `active: Section` string. Each component is conditionally rendered with `*ngIf="active === 'section'"`. There are no routes or URL changes. The 7 sections are:

| Section | Icon |
|---------|------|
| dashboard | dashboard |
| devices | router |
| telemetry | sensors |
| alerts | notifications_active |
| analytics | bar_chart |
| ml | psychology |
| health | monitor_heart |

The sidebar collapses to icon-only mode; state is persisted in `localStorage` (`iot_sidebar_col`). Dark mode is toggled via `document.body.classList.toggle('dark-mode')` and persisted in `localStorage` (`iot_dark`).

The alert badge on the sidebar nav item shows unacknowledged alert count, polled every 30 seconds.

## Topbar — Notification Bell

The topbar includes a notification bell icon with:
- A red badge showing the count of pending (unacknowledged) CRITICAL alerts
- A dropdown panel listing the most recent pending critical alerts (device, message, timestamp)
- Auto-refreshes every 30 seconds alongside the sidebar badge poll

## Services

### AuthService

- `login(username, password)` — posts to `/api/v1/auth/login`, stores JWT in `localStorage`
- `logout()` — clears localStorage, resets BehaviorSubject
- `isAuthenticated()` — checks localStorage for a token
- `getToken()` — returns raw JWT string

### ApiService

All requests include `Authorization: Bearer <token>` from `AuthService`. Base URLs come from `environment.ts`, constructed dynamically from `window.location.hostname`:
- Gateway: `<protocol>//<hostname>:8080/api/v1`
- ML API: `<protocol>//<hostname>:8000`

Key methods:

| Method | Endpoint |
|--------|---------|
| `getDevices()` | GET /devices |
| `createDevice(id, type)` | POST /devices |
| `deleteDevice(id)` | DELETE /devices/{id} |
| `sendTelemetry(deviceId, temp, hum, vib)` | POST /telemetry |
| `getAlerts()` | GET /alerts |
| `acknowledgeAlert(id)` | PATCH /alerts/{id}/acknowledge |
| `getDeviceStats(deviceId)` | GET /analytics/stats/{deviceId} |
| `getDeviceHistory(deviceId)` | GET /analytics/history/{deviceId} |
| `getTemperatureThreshold()` | GET /rules/temperature |
| `setTemperatureThreshold(value)` | POST /rules/temperature |
| `getMlStats()` | GET http://…:8000/stats |
| `getMlHealth()` | GET http://…:8000/health |
| `getMlAnomalyStats()` | GET http://…:8000/anomaly-stats |
| `getAutotrain()` | GET http://…:8000/autotrain |
| `setAutotrain(enabled, hours)` | POST http://…:8000/autotrain |
| `predict(deviceId, temp, hum, vib)` | POST http://…:8000/predict |
| `trainModel()` | POST http://…:8000/train |
| `getGatewayHealth()` | GET /actuator/health (via gateway) |

## Components

### LoginComponent

Split-panel layout: dark branding panel on the left (hidden on mobile), login form on the right. Submits to `AuthService.login()`. Shows error inline on failure. Default credentials shown in a hint box: `admin / admin123`.

### DashboardComponent

Auto-refreshes every 15 seconds via `interval(15000)`. KPIs:
- Device count, total alerts, pending alerts, critical alerts
- ML events processed, ML platform online/offline

Charts:
- ngx-charts pie — alert severity distribution (CRITICAL/HIGH/MEDIUM/LOW)
- ngx-charts bar-vertical — event count per registered device

Recent alerts section: last 8 alerts sorted by timestamp descending.

"Retrain ML" button — calls `POST /train`, shows snackbar on result.

### DevicesComponent

Displays all registered devices in a searchable table (client-side filter by deviceId, type, status). Fields: Device ID, Type, Status (ACTIVE/inactive), **Online/Offline badge**, **Last Seen** column, Registration date.

**Online/Offline badge**: derived from `lastSeen` epoch ms returned by `GET /analytics/stats/{deviceId}`. A device is considered online if `lastSeen` is within the last 2 minutes; offline (or never seen) otherwise. Badge updates on each table load.

**Last Seen column**: shows a human-readable relative time (e.g. "2 min ago") or "Never" if no telemetry has been received.

Register form (collapsible): Device ID (free text) + Type dropdown (TEMPERATURE / HUMIDITY / VIBRATION / MULTI_SENSOR).

Per-row actions:
- **Send telemetry** — opens a modal with temperature/humidity/vibration sliders and numeric inputs. Includes quick presets: Normal (22°C / 55% / 0.01 m/s²), Warning (75°C / 85% / 3.5 m/s²), Critical (115°C / 95% / 8.0 m/s²). Visual feedback when temperature crosses warning (>80°C) or critical (>100°C) thresholds.
- **Delete** — requires confirmation.

### TelemetryComponent

Device selector dropdown (loaded from `getDevices()`). Three sensor controls — each with a slider and a numeric input:
- Temperature: -20 to 150°C
- Humidity: 0 to 100%
- Vibration: 0 to 15 m/s²

Quick presets same as the modal in DevicesComponent. Session history panel on the right: last 20 submissions with success/failure state, device, timestamp, and values sent.

### AlertsComponent

Auto-refreshes every 10 seconds via `interval(10000)`. Filters:
- Severity cards (CRITICAL / HIGH / MEDIUM / LOW) — click to filter, click again to clear
- Status pills: All / Pending / Acknowledged

Acknowledge All button — calls `acknowledgeAlert` for every unacknowledged alert in parallel. Unacknowledged count shown as badge next to the page heading.

**Export CSV** — downloads all currently visible alerts as a CSV file with columns: ID, Device, Severity, Status, Message, Timestamp.

**Alert Rules panel** — a collapsible side panel showing the current temperature threshold. Editable inline: enter a new value and click Save. Calls `POST /rules/temperature`. Changes take effect immediately in the processing pipeline without restarting any service.

### AnalyticsComponent

Loads all registered devices on init, then calls `getDeviceStats()` for each in parallel via `forkJoin`. Displays:
- Bar chart (ngx-charts bar-vertical): event count per device
- Stats table: rank, device ID (clickable to select), total events, share % with a progress bar

**Telemetry History line chart** — clicking a device loads its history via `GET /analytics/history/{deviceId}` and renders a line chart with three tabs: Temperature, Humidity, Vibration. Each tab shows the last 50 readings over time. The chart uses the `ts` epoch ms field as the x-axis.

Clicking a device ID in the table selects it and loads its individual KPI (deviceId + event count).

### MlComponent

**Anomaly Stats KPIs** (from `GET /anomaly-stats`):
- Total predictions processed
- Anomaly count and anomaly rate (%)
- Number of affected devices
- Most anomalous device

**Recent anomalies list** — shows the 10 most recent anomalous predictions from the in-memory history: device ID, timestamp, and anomaly score.

**Prediction panel**: enter device ID + sensor values, choose Normal or Anomalous preset, call `POST /predict`. Result shows `is_anomaly`, `anomaly_score`, and `prediction` label with color-coded styling.

**Training panel**: "Retrain Model" button calls `POST /train`. Shows a 4-step training pipeline description (reads Parquet → fits IsolationForest → saves model → predictions available). Displays training result or error message.

**Auto-retrain toggle** — a slide toggle that enables/disables automatic background retraining. When enabled, an interval input (in hours) sets how often to retrain. Calls `POST /autotrain`. The current config is loaded on component init from `GET /autotrain`.

### HealthComponent

Checks 3 endpoints on init and on each "Refresh All":
- API Gateway: `/actuator/health`
- ML Platform: `/health`
- Discovery Service: `/actuator/health`

Overall status banner (all-up green / partial amber). Service cards show status, URL, last checked time. Gateway card expands to show Spring Boot actuator component breakdown. ML card shows `model_loaded` flag. Architecture flow diagram at the bottom.
