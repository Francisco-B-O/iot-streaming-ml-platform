import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, of, catchError, switchMap } from 'rxjs';
import * as L from 'leaflet';
import 'leaflet-draw';
import 'leaflet.heat';

import { ApiService } from '../services/api.service';

// ── Leaflet icon fix for webpack bundling ──────────────────────────────────
(L.Icon.Default as any).imagePath = 'https://unpkg.com/leaflet@1.9.4/dist/images/';

// ── Leaflet.heat type shim ─────────────────────────────────────────────────
declare module 'leaflet' {
  function heatLayer(latlngs: Array<[number, number, number?]>, options?: Record<string, unknown>): L.Layer;
}

interface MapDevice {
  deviceId: string;
  type: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  simulated: boolean;
  areaName: string | null;
  isAnomaly?: boolean;
  anomalyScore?: number;
}

interface MapArea {
  id: string;
  name: string;
  polygon: number[][];
  deviceCount: number;
  deviceIds: string[];
}

@Component({
  selector: 'app-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="map-page">

      <!-- ── Left control panel ─────────────────────────────── -->
      <aside class="map-panel">

        <div class="panel-section">
          <h3 class="section-title"><mat-icon>tune</mat-icon>Filters</h3>

          <label class="field-label">Area</label>
          <select class="field-select" [(ngModel)]="filterArea" (change)="applyFilters()">
            <option value="">All Areas</option>
            <option *ngFor="let a of areas" [value]="a.id">{{ a.name }}</option>
          </select>

          <label class="field-label" style="margin-top:.75rem">Severity</label>
          <select class="field-select" [(ngModel)]="filterSeverity" (change)="applyFilters()">
            <option value="">All</option>
            <option value="normal">Normal</option>
            <option value="anomaly">Anomaly</option>
          </select>
        </div>

        <div class="panel-section">
          <h3 class="section-title"><mat-icon>layers</mat-icon>Layers</h3>
          <label class="toggle-row">
            <input type="checkbox" [(ngModel)]="showHeatmap" (change)="toggleHeatmap()">
            <span>Temperature heatmap</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" [(ngModel)]="showAreas" (change)="toggleAreas()">
            <span>Area polygons</span>
          </label>
        </div>

        <div class="panel-section">
          <h3 class="section-title"><mat-icon>pentagon</mat-icon>Areas</h3>

          <button class="draw-btn" (click)="startDraw()" [class.active]="isDrawing">
            <mat-icon>edit</mat-icon>
            {{ isDrawing ? 'Click map to draw…' : 'Draw new area' }}
          </button>

          <div class="new-area-form" *ngIf="pendingPolygon">
            <input class="field-input" placeholder="Area name…" [(ngModel)]="newAreaName" (keydown.enter)="saveArea()">
            <div class="form-btns">
              <button class="btn-save" (click)="saveArea()">Save</button>
              <button class="btn-cancel" (click)="cancelArea()">Cancel</button>
            </div>
          </div>

          <div class="area-list">
            <div class="area-item" *ngFor="let a of areas"
                 [class.selected]="filterArea === a.id"
                 (click)="selectArea(a)">
              <div class="area-info">
                <span class="area-name">{{ a.name }}</span>
                <span class="area-count">{{ a.deviceCount }} device{{ a.deviceCount !== 1 ? 's' : '' }}</span>
              </div>
              <button class="area-del" (click)="deleteArea(a.id, $event)" matTooltip="Delete area">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
            <div class="empty-msg" *ngIf="areas.length === 0">No areas defined</div>
          </div>
        </div>

        <div class="panel-section">
          <h3 class="section-title"><mat-icon>info</mat-icon>Legend</h3>
          <div class="legend">
            <div class="legend-row"><span class="dot dot-green"></span>Active — normal</div>
            <div class="legend-row"><span class="dot dot-yellow"></span>Active — score &gt; 0.3</div>
            <div class="legend-row"><span class="dot dot-red"></span>Active — anomaly</div>
            <div class="legend-row"><span class="dot dot-gray"></span>Inactive / offline</div>
            <div class="legend-row"><span class="dot dot-blue"></span>No GPS coordinates</div>
          </div>
        </div>

        <div class="panel-stats">
          <div class="stat-chip">
            <span class="stat-num">{{ totalDevices }}</span>
            <span class="stat-label">Devices</span>
          </div>
          <div class="stat-chip anomaly">
            <span class="stat-num">{{ anomalyCount }}</span>
            <span class="stat-label">Anomalies</span>
          </div>
          <div class="stat-chip">
            <span class="stat-num">{{ areas.length }}</span>
            <span class="stat-label">Areas</span>
          </div>
          <div class="stat-chip no-gps" *ngIf="noGpsCount > 0" matTooltip="Devices without GPS coordinates — not shown on map">
            <span class="stat-num">{{ noGpsCount }}</span>
            <span class="stat-label">No GPS</span>
          </div>
        </div>

        <button class="refresh-btn" (click)="loadData()" matTooltip="Refresh map data">
          <mat-icon>refresh</mat-icon> Refresh
        </button>
      </aside>

      <!-- ── Map canvas ──────────────────────────────────────── -->
      <div class="map-wrap">
        <div #mapEl id="iot-map"></div>
        <div class="map-loading" *ngIf="loading">
          <mat-icon class="spin">sync</mat-icon>
          <span>Loading map data…</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .map-page {
      display: flex;
      height: 100%;
      overflow: hidden;
      background: var(--bg, #f8fafc);
    }

    /* ── Panel ──────────────────────────────────────────────── */
    .map-panel {
      width: 280px;
      min-width: 240px;
      background: var(--surface, #fff);
      border-right: 1px solid var(--border, #e2e8f0);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      flex-shrink: 0;
    }

    .panel-section {
      padding: 1rem;
      border-bottom: 1px solid var(--border-2, #f1f5f9);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: .78rem;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--text-muted, #94a3b8);
      margin: 0 0 .75rem;
    }
    .section-title mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .field-label {
      display: block;
      font-size: .75rem;
      font-weight: 600;
      color: var(--text-secondary, #64748b);
      margin-bottom: 4px;
    }

    .field-select, .field-input {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 8px;
      background: var(--surface, #fff);
      color: var(--text-primary, #0f172a);
      font-size: .82rem;
      outline: none;
      box-sizing: border-box;
    }
    .field-select:focus, .field-input:focus {
      border-color: var(--indigo, #6366f1);
      box-shadow: 0 0 0 2px rgba(99,102,241,.15);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: .82rem;
      color: var(--text-secondary, #64748b);
      margin-bottom: .5rem;
      cursor: pointer;
    }
    .toggle-row input[type=checkbox] { accent-color: var(--indigo, #6366f1); }

    /* Draw button */
    .draw-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 8px 12px;
      border: 1.5px dashed var(--border, #e2e8f0);
      border-radius: 8px;
      background: transparent;
      color: var(--indigo, #6366f1);
      font-size: .82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all .2s;
    }
    .draw-btn:hover, .draw-btn.active {
      background: rgba(99,102,241,.07);
      border-color: var(--indigo, #6366f1);
    }
    .draw-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .new-area-form {
      margin-top: .75rem;
      padding: .75rem;
      background: var(--surface-2, #f8fafc);
      border-radius: 8px;
      border: 1px solid var(--indigo, #6366f1);
    }
    .form-btns {
      display: flex;
      gap: 6px;
      margin-top: .5rem;
    }
    .btn-save {
      flex: 1;
      padding: 6px;
      background: var(--indigo, #6366f1);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: .78rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-cancel {
      flex: 1;
      padding: 6px;
      background: var(--surface, #fff);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: .78rem;
      cursor: pointer;
    }

    /* Area list */
    .area-list { margin-top: .5rem; }
    .area-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 8px;
      border-radius: 8px;
      cursor: pointer;
      transition: background .15s;
    }
    .area-item:hover { background: var(--surface-2, #f8fafc); }
    .area-item.selected { background: rgba(99,102,241,.08); }
    .area-info { display: flex; flex-direction: column; }
    .area-name { font-size: .82rem; font-weight: 600; color: var(--text-primary); }
    .area-count { font-size: .7rem; color: var(--text-muted); }
    .area-del {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 3px;
      border-radius: 5px;
      line-height: 1;
      opacity: 0;
      transition: opacity .15s, color .15s;
    }
    .area-item:hover .area-del { opacity: 1; }
    .area-del:hover { color: #ef4444; }
    .area-del mat-icon { font-size: 16px; width: 16px; height: 16px; display: block; }

    .empty-msg {
      font-size: .78rem;
      color: var(--text-muted);
      text-align: center;
      padding: .5rem;
    }

    /* Legend */
    .legend { display: flex; flex-direction: column; gap: 5px; }
    .legend-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: .78rem;
      color: var(--text-secondary);
    }
    .dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 1.5px solid rgba(255,255,255,.6);
      flex-shrink: 0;
    }
    .dot-green  { background: #22c55e; }
    .dot-yellow { background: #f59e0b; }
    .dot-red    { background: #ef4444; }
    .dot-gray   { background: #94a3b8; }
    .dot-blue   { background: #3b82f6; }

    /* Stats */
    .panel-stats {
      display: flex;
      gap: .5rem;
      padding: .75rem 1rem;
      border-bottom: 1px solid var(--border-2, #f1f5f9);
    }
    .stat-chip {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 6px;
      background: var(--surface-2, #f8fafc);
      border-radius: 8px;
      border: 1px solid var(--border, #e2e8f0);
    }
    .stat-chip.anomaly { background: rgba(239,68,68,.05); border-color: rgba(239,68,68,.2); }
    .stat-chip.no-gps  { background: rgba(59,130,246,.05); border-color: rgba(59,130,246,.2); }
    .stat-num {
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--text-primary);
      line-height: 1;
    }
    .stat-chip.anomaly .stat-num { color: #ef4444; }
    .stat-chip.no-gps  .stat-num { color: #3b82f6; }
    .stat-label { font-size: .62rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }

    /* Refresh */
    .refresh-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: .75rem 1rem 1rem;
      padding: 8px;
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 8px;
      background: var(--surface, #fff);
      color: var(--text-secondary);
      font-size: .8rem;
      font-weight: 600;
      cursor: pointer;
      transition: background .15s;
    }
    .refresh-btn:hover { background: var(--surface-2, #f8fafc); }
    .refresh-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* ── Map ────────────────────────────────────────────────── */
    .map-wrap { flex: 1; position: relative; }
    #iot-map { width: 100%; height: 100%; }

    .map-loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: .5rem;
      background: rgba(255,255,255,.7);
      font-size: .9rem;
      font-weight: 600;
      color: var(--indigo, #6366f1);
      z-index: 9999;
    }
    .map-loading mat-icon { font-size: 24px; width: 24px; height: 24px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; }

    /* Responsive */
    @media (max-width: 768px) {
      .map-page { flex-direction: column; }
      .map-panel {
        width: 100%;
        max-height: 40vh;
        border-right: none;
        border-bottom: 1px solid var(--border);
      }
      #iot-map { min-height: 60vh; }
    }
  `]
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef;

  // State
  loading = false;
  devices: MapDevice[] = [];
  areas: MapArea[] = [];
  filterArea = '';
  filterSeverity = '';
  showHeatmap = false;
  showAreas = true;
  isDrawing = false;
  pendingPolygon: number[][] | null = null;
  newAreaName = '';

  // Computed
  get totalDevices()  { return this.devices.length; }
  get anomalyCount()  { return this.devices.filter(d => d.isAnomaly).length; }
  get noGpsCount()    { return this.devices.filter(d => d.latitude == null || d.longitude == null).length; }

  // Leaflet instances
  private map!: L.Map;
  private markerGroup!: L.LayerGroup;
  private areaGroup!: L.LayerGroup;
  private heatLayer?: L.Layer;
  private drawControl?: any;
  private drawnItems!: L.FeatureGroup;

  // Marker map and temperature cache (lazy-loaded on popup open)
  private readonly markerMap  = new Map<string, L.CircleMarker>();
  private readonly tempCache  = new Map<string, number | null>();
  // Area layer map for edit support (areaId → L.Polygon)
  private readonly areaLayerMap = new Map<string, L.Polygon>();

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  // ── Map init ─────────────────────────────────────────────────────────────

  private initMap(): void {
    this.map = L.map(this.mapEl.nativeElement, { zoomControl: true }).setView([40.4, -3.7], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.markerGroup = L.layerGroup().addTo(this.map);
    this.areaGroup   = L.layerGroup().addTo(this.map);
    this.drawnItems  = new L.FeatureGroup().addTo(this.map);

    this.initDrawControl();
  }

  private initDrawControl(): void {
    this.drawControl = new (L.Control as any).Draw({
      draw: {
        polygon:      { shapeOptions: { color: '#6366f1', fillOpacity: 0.15 } },
        polyline:     false,
        rectangle:    false,
        circle:       false,
        marker:       false,
        circlemarker: false,
      },
      edit: { featureGroup: this.drawnItems },
    });

    // New polygon drawn
    this.map.on('draw:created', (e: any) => {
      const layer = e.layer as L.Polygon;
      const latlngs = (layer.getLatLngs()[0] as L.LatLng[]).map(ll => [ll.lat, ll.lng]);
      this.pendingPolygon = latlngs;
      this.isDrawing = false;
      this.stopDraw();
      this.cdr.markForCheck();
    });

    // Existing polygon edited — persist each changed area to backend
    this.map.on('draw:edited', (e: any) => {
      const layers = e.layers;
      layers.eachLayer((layer: any) => {
        const areaId = layer.areaId as string | undefined;
        if (!areaId) return;
        const area = this.areas.find(a => a.id === areaId);
        if (!area) return;
        const newCoords = (layer.getLatLngs()[0] as L.LatLng[]).map(ll => [ll.lat, ll.lng]);
        this.api.updateAreaPolygon(areaId, area.name, newCoords)
          .pipe(catchError(() => of(null)))
          .subscribe(updated => {
            if (updated) this.loadData();
          });
      });
    });
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  loadData(): void {
    this.loading = true;
    this.cdr.markForCheck();

    forkJoin({
      devices: this.api.getDevicesForMap().pipe(catchError(() => of([]))),
      areas:   this.api.getAreas().pipe(catchError(() => of([]))),
      anomaly: this.api.getMlAnomalyStats().pipe(catchError(() => of({ recent_anomalies: [] }))),
    }).subscribe(({ devices, areas, anomaly }) => {
      const anomalySet = new Set<string>(
        (anomaly.recent_anomalies ?? []).map((a: any) => a.device_id as string)
      );

      this.devices = (devices as any[]).map(d => ({
        ...d,
        isAnomaly:    anomalySet.has(d.deviceId),
        anomalyScore: (anomaly.recent_anomalies ?? [])
          .find((a: any) => a.device_id === d.deviceId)?.score ?? 0,
      }));

      this.areas = areas as MapArea[];
      this.loading = false;
      this.renderMap();
      this.cdr.markForCheck();
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private renderMap(): void {
    this.renderMarkers();
    if (this.showAreas) this.renderAreas();
    if (this.showHeatmap) this.renderHeatmap();
  }

  private renderMarkers(): void {
    this.markerGroup.clearLayers();
    this.markerMap.clear();

    const filtered = this.filteredDevices();

    filtered.forEach(d => {
      if (d.latitude == null || d.longitude == null) return;

      const marker = L.circleMarker([d.latitude, d.longitude], {
        radius:      8,
        fillColor:   this.markerColor(d),
        color:       '#fff',
        weight:      2,
        opacity:     1,
        fillOpacity: 0.9,
      });

      marker.bindPopup(this.buildPopup(d), { maxWidth: 240 });

      // Lazy-load temperature when popup opens
      marker.on('popupopen', () => this.loadTemperature(d.deviceId));

      marker.addTo(this.markerGroup);
      this.markerMap.set(d.deviceId, marker);
    });
  }

  private renderAreas(): void {
    this.areaGroup.clearLayers();
    this.drawnItems.clearLayers();
    this.areaLayerMap.clear();
    if (!this.showAreas) return;

    const anomalyDeviceIds = new Set(this.devices.filter(d => d.isAnomaly).map(d => d.deviceId));

    this.areas.forEach(area => {
      const latlngs = area.polygon.map(p => [p[0], p[1]] as [number, number]);
      if (latlngs.length < 3) return;

      const isHighRisk = (area.deviceIds ?? []).some(id => anomalyDeviceIds.has(id));
      const color = isHighRisk ? '#ef4444' : '#6366f1';

      const poly = L.polygon(latlngs, {
        color,
        weight:      isHighRisk ? 2.5 : 1.5,
        fillColor:   color,
        fillOpacity: isHighRisk ? 0.14 : 0.06,
        dashArray:   isHighRisk ? undefined : '4 4',
      });

      // Tag layer with areaId so draw:edited can identify it
      (poly as any).areaId = area.id;

      poly.bindTooltip(
        `${area.name}${isHighRisk ? ' ⚠ anomalies detected' : ''}`,
        { permanent: true, direction: 'center', className: `area-label${isHighRisk ? ' area-label-risk' : ''}` }
      );

      // Add to both the visible group and drawnItems (so Leaflet.draw can edit it)
      poly.addTo(this.areaGroup);
      this.drawnItems.addLayer(poly);
      this.areaLayerMap.set(area.id, poly);
    });
  }

  private renderHeatmap(): void {
    if (this.heatLayer) {
      this.map.removeLayer(this.heatLayer);
      this.heatLayer = undefined;
    }
    if (!this.showHeatmap) return;

    // Use anomaly score as continuous intensity: anomaly devices show full score,
    // non-anomaly devices show a faint baseline (0.15) so all GPS devices appear.
    const points: Array<[number, number, number]> = this.devices
      .filter(d => d.latitude != null && d.longitude != null)
      .map(d => [d.latitude!, d.longitude!, d.isAnomaly ? Math.max(0.6, d.anomalyScore ?? 0.6) : 0.15]);

    if (points.length === 0) return;

    this.heatLayer = (L as any).heatLayer(points, {
      radius:  35,
      blur:    20,
      maxZoom: 14,
      gradient: { 0.0: '#22c55e', 0.5: '#f59e0b', 1.0: '#ef4444' },
    }).addTo(this.map);
  }

  // ── Filters ──────────────────────────────────────────────────────────────

  applyFilters(): void {
    this.renderMarkers();
  }

  private filteredDevices(): MapDevice[] {
    return this.devices.filter(d => {
      if (this.filterArea) {
        const area = this.areas.find(a => a.id === this.filterArea);
        if (!area?.deviceIds.includes(d.deviceId)) return false;
      }
      if (this.filterSeverity === 'anomaly' && !d.isAnomaly) return false;
      if (this.filterSeverity === 'normal'  &&  d.isAnomaly) return false;
      return true;
    });
  }

  selectArea(area: MapArea): void {
    this.filterArea = this.filterArea === area.id ? '' : area.id;
    this.applyFilters();
  }

  // ── Toggle layers ────────────────────────────────────────────────────────

  toggleHeatmap(): void {
    if (this.showHeatmap) {
      this.renderHeatmap();
    } else if (this.heatLayer) {
      this.map.removeLayer(this.heatLayer);
      this.heatLayer = undefined;
    }
  }

  toggleAreas(): void {
    if (this.showAreas) {
      this.renderAreas();
    } else {
      this.areaGroup.clearLayers();
    }
  }

  // ── Draw control ─────────────────────────────────────────────────────────

  startDraw(): void {
    if (this.isDrawing) { this.stopDraw(); return; }
    this.isDrawing = true;
    this.pendingPolygon = null;
    this.drawControl.addTo(this.map);
    new (L as any).Draw.Polygon(this.map, this.drawControl.options.draw.polygon).enable();
  }

  private stopDraw(): void {
    try { this.map.removeControl(this.drawControl); } catch (_) {}
  }

  saveArea(): void {
    if (!this.pendingPolygon || !this.newAreaName.trim()) return;
    this.api.createArea(this.newAreaName.trim(), this.pendingPolygon)
      .subscribe(() => {
        this.pendingPolygon = null;
        this.newAreaName = '';
        this.drawnItems.clearLayers();
        this.loadData();
      });
  }

  cancelArea(): void {
    this.pendingPolygon = null;
    this.newAreaName = '';
    this.drawnItems.clearLayers();
    this.cdr.markForCheck();
  }

  // ── Area management ──────────────────────────────────────────────────────

  deleteArea(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this area?')) return;
    this.api.deleteArea(id).subscribe(() => this.loadData());
  }

  // ── Temperature lazy-load ─────────────────────────────────────────────────

  private loadTemperature(deviceId: string): void {
    if (this.tempCache.has(deviceId)) {
      this.updateTempInPopup(deviceId, this.tempCache.get(deviceId) ?? null);
      return;
    }
    this.api.getDeviceHistory(deviceId)
      .pipe(catchError(() => of([])))
      .subscribe((history: any[]) => {
        const temp = history.length > 0 ? (history[0]?.temperature ?? null) : null;
        this.tempCache.set(deviceId, temp);
        this.updateTempInPopup(deviceId, temp);
      });
  }

  private updateTempInPopup(deviceId: string, temp: number | null): void {
    const el = document.getElementById(`pop-temp-${deviceId}`);
    if (el) el.textContent = temp != null ? `${(temp as number).toFixed(1)} °C` : 'N/A';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  markerColor(d: MapDevice): string {
    if (d.latitude == null || d.longitude == null) return '#3b82f6';
    if (d.status !== 'ACTIVE') return '#94a3b8';
    if (d.isAnomaly) return '#ef4444';
    if ((d.anomalyScore ?? 0) > 0.3) return '#f59e0b';
    return '#22c55e';
  }

  private buildPopup(d: MapDevice): string {
    const severity = d.isAnomaly
      ? `<span class="pop-badge anomaly">ANOMALY</span>`
      : `<span class="pop-badge normal">NORMAL</span>`;
    const area  = d.areaName ? `<div class="pop-row"><b>Area</b> ${d.areaName}</div>` : '';
    const score = d.isAnomaly && d.anomalyScore != null
      ? `<div class="pop-row"><b>Score</b> ${(d.anomalyScore as number).toFixed(4)}</div>` : '';
    // Temperature is fetched lazily on popupopen; the span id is used to inject the value
    const cached = this.tempCache.has(d.deviceId)
      ? (this.tempCache.get(d.deviceId) != null ? `${(this.tempCache.get(d.deviceId) as number).toFixed(1)} °C` : 'N/A')
      : '…';
    return `
      <div class="iot-popup">
        <div class="pop-header">
          <span class="pop-id">${d.deviceId}</span>
          ${severity}
        </div>
        <div class="pop-row"><b>Temp</b> <span id="pop-temp-${d.deviceId}">${cached}</span></div>
        <div class="pop-row"><b>Type</b> ${d.type}</div>
        <div class="pop-row"><b>Status</b> ${d.status}</div>
        ${area}
        ${score}
        <div class="pop-row"><b>Simulated</b> ${d.simulated ? 'Yes' : 'No'}</div>
      </div>`;
  }
}
