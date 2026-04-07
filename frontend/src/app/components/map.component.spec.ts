import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';

import { MapComponent } from './map.component';
import { ApiService } from '../services/api.service';

const mockDevices = [
  { deviceId: 'dev-1', type: 'TEMPERATURE', status: 'ACTIVE',  latitude: 40.4,  longitude: -3.7,  simulated: false, areaName: 'Zone A' },
  { deviceId: 'dev-2', type: 'HUMIDITY',    status: 'ACTIVE',  latitude: 40.41, longitude: -3.71, simulated: true,  areaName: null },
  { deviceId: 'dev-3', type: 'VIBRATION',   status: 'OFFLINE', latitude: null,  longitude: null,  simulated: false, areaName: null },
];

const mockAreas = [
  { id: 'area-1', name: 'Zone A', polygon: [[40.4, -3.7], [40.5, -3.7], [40.5, -3.8]], deviceCount: 1, deviceIds: ['dev-1'] },
];

const mockAnomalyStats = {
  anomalyRate: 0.15,
  totalPredictions: 20,
  anomalyCount: 1,
  recent_anomalies: [{ device_id: 'dev-2', score: 0.82, timestamp: '2026-01-01T00:00:00Z' }],
};

describe('MapComponent', () => {
  let component: MapComponent;
  let fixture: ComponentFixture<MapComponent>;
  let apiSpy: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('ApiService', [
      'getDevicesForMap', 'getAreas', 'getMlAnomalyStats',
      'createArea', 'deleteArea', 'assignDeviceToArea',
    ]);
    apiSpy.getDevicesForMap.and.returnValue(of(mockDevices));
    apiSpy.getAreas.and.returnValue(of(mockAreas));
    apiSpy.getMlAnomalyStats.and.returnValue(of(mockAnomalyStats));

    await TestBed.configureTestingModule({
      imports: [MapComponent, HttpClientTestingModule],
      providers: [{ provide: ApiService, useValue: apiSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;

    // Prevent Leaflet from trying to render into a real DOM
    spyOn(component as any, 'initMap').and.stub();
    spyOn(component as any, 'renderMap').and.stub();
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should call getDevicesForMap, getAreas and getMlAnomalyStats on init', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(apiSpy.getDevicesForMap).toHaveBeenCalledTimes(1);
    expect(apiSpy.getAreas).toHaveBeenCalledTimes(1);
    expect(apiSpy.getMlAnomalyStats).toHaveBeenCalledTimes(1);
  }));

  it('should populate devices after load', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(component.devices.length).toBe(3);
  }));

  it('should populate areas after load', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(component.areas.length).toBe(1);
    expect(component.areas[0].name).toBe('Zone A');
  }));

  it('should mark anomaly device from recent_anomalies', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    const anomalyDev = component.devices.find(d => d.deviceId === 'dev-2');
    expect(anomalyDev?.isAnomaly).toBeTrue();
  }));

  it('should not mark non-anomaly device', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    const normalDev = component.devices.find(d => d.deviceId === 'dev-1');
    expect(normalDev?.isAnomaly).toBeFalse();
  }));

  it('totalDevices getter should reflect loaded devices', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(component.totalDevices).toBe(3);
  }));

  it('anomalyCount getter should count anomaly devices', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(component.anomalyCount).toBe(1);
  }));

  it('should set loading to false after data loads', fakeAsync(() => {
    component.loading = true;
    fixture.detectChanges();
    tick();
    expect(component.loading).toBeFalse();
  }));

  it('should still set loading false when API returns error', fakeAsync(() => {
    apiSpy.getDevicesForMap.and.returnValue(throwError(() => new Error('Network error')));
    fixture.detectChanges();
    tick();
    expect(component.loading).toBeFalse();
  }));

  it('should reset pendingPolygon and newAreaName on cancelArea', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    component.pendingPolygon = [[1, 2], [3, 4], [5, 6]];
    component.newAreaName = 'Draft';
    component.cancelArea();
    expect(component.pendingPolygon).toBeNull();
    expect(component.newAreaName).toBe('');
  }));

  it('selectArea should set filterArea when unselected', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    component.filterArea = '';
    component.selectArea(mockAreas[0] as any);
    expect(component.filterArea).toBe('area-1');
  }));

  it('selectArea should clear filterArea when same area clicked again', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    component.filterArea = 'area-1';
    component.selectArea(mockAreas[0] as any);
    expect(component.filterArea).toBe('');
  }));

  it('should call deleteArea API on deleteArea', fakeAsync(() => {
    apiSpy.deleteArea.and.returnValue(of({}));
    fixture.detectChanges();
    tick();
    const stopPropSpy = jasmine.createSpyObj<Event>('Event', ['stopPropagation']);
    spyOn(window, 'confirm').and.returnValue(true);
    component.deleteArea('area-1', stopPropSpy);
    tick();
    expect(apiSpy.deleteArea).toHaveBeenCalledWith('area-1');
  }));

  it('should not call deleteArea API if confirm is cancelled', fakeAsync(() => {
    apiSpy.deleteArea.and.returnValue(of({}));
    fixture.detectChanges();
    tick();
    const stopPropSpy = jasmine.createSpyObj<Event>('Event', ['stopPropagation']);
    spyOn(window, 'confirm').and.returnValue(false);
    component.deleteArea('area-1', stopPropSpy);
    tick();
    expect(apiSpy.deleteArea).not.toHaveBeenCalled();
  }));

  it('should reload data after deleteArea succeeds', fakeAsync(() => {
    apiSpy.deleteArea.and.returnValue(of({}));
    fixture.detectChanges();
    tick();
    const stopPropSpy = jasmine.createSpyObj<Event>('Event', ['stopPropagation']);
    spyOn(window, 'confirm').and.returnValue(true);
    component.deleteArea('area-1', stopPropSpy);
    tick();
    // loadData called once on init + once after delete
    expect(apiSpy.getDevicesForMap).toHaveBeenCalledTimes(2);
  }));

  it('should not save area when pendingPolygon is null', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    component.pendingPolygon = null;
    component.newAreaName = 'Zone B';
    component.saveArea();
    expect(apiSpy.createArea).not.toHaveBeenCalled();
  }));

  // ── markerColor ───────────────────────────────────────────────────────────

  it('markerColor should return green for active normal device', () => {
    const color = component.markerColor({ status: 'ACTIVE', latitude: 1, longitude: 1, isAnomaly: false, anomalyScore: 0 } as any);
    expect(color).toBe('#22c55e');
  });

  it('markerColor should return red for anomaly device', () => {
    const color = component.markerColor({ status: 'ACTIVE', latitude: 1, longitude: 1, isAnomaly: true, anomalyScore: 0.9 } as any);
    expect(color).toBe('#ef4444');
  });

  it('markerColor should return yellow when anomalyScore > 0.3 but not anomaly', () => {
    const color = component.markerColor({ status: 'ACTIVE', latitude: 1, longitude: 1, isAnomaly: false, anomalyScore: 0.5 } as any);
    expect(color).toBe('#f59e0b');
  });

  it('markerColor should return gray for inactive device', () => {
    const color = component.markerColor({ status: 'OFFLINE', latitude: 1, longitude: 1, isAnomaly: false, anomalyScore: 0 } as any);
    expect(color).toBe('#94a3b8');
  });

  it('markerColor should return blue for device without GPS', () => {
    const color = component.markerColor({ status: 'ACTIVE', latitude: null, longitude: null, isAnomaly: false, anomalyScore: 0 } as any);
    expect(color).toBe('#3b82f6');
  });

  // ── noGpsCount getter ─────────────────────────────────────────────────────

  it('noGpsCount should count devices without coordinates', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(component.noGpsCount).toBe(1); // dev-3 has null lat/lng
  }));

  it('should not save area when name is blank', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    component.pendingPolygon = [[1, 2], [3, 4], [5, 6]];
    component.newAreaName = '  ';
    component.saveArea();
    expect(apiSpy.createArea).not.toHaveBeenCalled();
  }));

  it('should call createArea and reload when saveArea succeeds', fakeAsync(() => {
    apiSpy.createArea.and.returnValue(of({}));
    fixture.detectChanges();
    tick();
    const polygon = [[40.4, -3.7], [40.5, -3.7], [40.5, -3.8]];
    component.pendingPolygon = polygon;
    component.newAreaName = 'Zone B';
    component.saveArea();
    tick();
    expect(apiSpy.createArea).toHaveBeenCalledWith('Zone B', polygon);
    expect(apiSpy.getDevicesForMap).toHaveBeenCalledTimes(2);
  }));
});
