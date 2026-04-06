# Usage

The dashboard runs at `http://localhost:4200` after `docker compose up -d`. All API traffic goes through the gateway at port 8080.

## Login

Default credentials: `admin` / `admin123`

The JWT is stored in `localStorage` and attached to every request. Session persists across page reloads until you log out or clear browser storage.

---

## Dashboard

The landing page. Auto-refreshes every 15 seconds.

**KPIs** — six cards at the top:
- Total registered devices
- Total, pending, and critical alert counts
- ML events processed (from the data lake)
- ML platform status (online / offline)

**Alert severity chart** — pie chart of CRITICAL / HIGH / MEDIUM / LOW distribution.

**Events per device chart** — bar chart showing how many telemetry events each device has generated.

**Recent alerts** — last 8 alerts sorted newest-first, with severity, device, message, and acknowledge status.

**Retrain ML** button — triggers a full model retraining on the current data lake. Takes a few seconds; a snackbar confirms completion.

---

## Devices

Register and manage IoT sensors.

**Register a device** — click "Register Device", enter a Device ID (e.g. `sensor-01`) and choose a type (TEMPERATURE / HUMIDITY / VIBRATION / MULTI_SENSOR). Click Register.

**Search** — filters the device table by device ID, type, or status in real time.

**Send telemetry** (sensor icon per row) — opens a modal to manually push a reading for that device:
- Adjust temperature, humidity, and vibration sliders or type values directly
- Quick presets: **Normal** (22°C / 55% / 0.01 m/s²), **Warning** (75°C / 85% / 3.5 m/s²), **Critical** (115°C / 95% / 8.0 m/s²)
- Temperature >80°C shows a warning indicator; >100°C shows a critical indicator
- Clicking Send pushes the reading to the Kafka ingestion pipeline

**Delete** (trash icon) — confirms and permanently removes the device.

---

## Telemetry

A dedicated page for pushing sensor readings without going through the device table.

Select a registered device from the dropdown. Adjust the three sensor sliders or type values directly. Quick presets work the same as in the Devices modal.

The **Session History** panel on the right records the last 20 submissions for this browser session, showing success/failure, device, timestamp, and values sent.

---

## Alerts

Alerts are generated automatically by the processing pipeline when sensor readings cross configured thresholds.

**Severity filter** — click any of the four severity cards (CRITICAL / HIGH / MEDIUM / LOW) to filter. Click the same card again to clear.

**Status filter** — All / Pending / Acknowledged pills at the top right.

**Acknowledge** — click the check icon on any alert to mark it acknowledged. The badge count in the sidebar nav updates automatically.

**Acknowledge All** — acknowledges all currently unacknowledged alerts in one click.

The page auto-refreshes every 10 seconds. Total and unacknowledged counts are shown in the header.

---

## Analytics

Per-device and comparative event statistics.

On load, the page fetches event counts for all registered devices in parallel. The bar chart and stats table show how events are distributed across devices, including each device's share (%) with a progress bar.

Select a specific device from the dropdown and click **Load Stats** to highlight it in the table and show its total event count as a KPI card.

Clicking a device name in the table selects it directly.

---

## ML Platform

Interface for the IsolationForest anomaly detection engine.

**Stats KPIs** — events in the data lake, number of tracked devices, platform online/offline status, last event timestamp.

**Devices in ML Data Lake** — chip list of device IDs that have data stored in Parquet format.

**Anomaly Prediction** — test the model with a custom input:
1. Enter a Device ID (must have history in the data lake for accurate rolling features)
2. Set temperature, humidity, and vibration values
3. Use **Normal** preset (22°C / 55% / 0.01 m/s²) or **Anomalous** preset (150°C / 99% / 12.0 m/s²) for quick tests
4. Click **Run Prediction** — result shows anomaly score, prediction label, and color-coded outcome

**Model Training** — click **Retrain Model** to trigger a full training run on the Parquet data lake. Training reads up to 10,000 records, fits the Isolation Forest, computes a threshold at the 5th percentile of training scores, and saves the model. The result message confirms completion or reports errors.

---

## Health

Real-time status of the three health-checked services:
- **API Gateway** (port 8080) — Spring Boot `/actuator/health` with component breakdown
- **ML Platform** (port 8000) — FastAPI `/health` with `model_loaded` flag
- **Discovery Service** (port 8761) — Eureka health endpoint

The top banner shows overall system status. Each service card shows Operational / Unreachable status with a pulsing green dot when healthy, plus the timestamp of the last check.

**Refresh All** re-checks all three simultaneously.

The architecture flow at the bottom shows the high-level data path: Kafka → Gateway → Microservices → ML Platform.

---

## Sidebar

- **Collapse** — click the chevron at the top of the sidebar to switch to icon-only mode. State is saved in `localStorage`.
- **Dark mode** — toggle in the sidebar footer or the topbar icon. Saved in `localStorage`.
- **Logout** — bottom of the sidebar footer. Clears the JWT from `localStorage`.
