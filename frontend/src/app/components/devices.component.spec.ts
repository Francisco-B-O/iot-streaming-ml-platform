import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DevicesComponent } from './devices.component';
import { ApiService } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

const mockDevices = [
  { deviceId: 'sensor-01', type: 'TEMPERATURE', status: 'ACTIVE', simulated: false, registeredAt: '2026-01-01' },
  { deviceId: 'sensor-02', type: 'HUMIDITY',    status: 'ACTIVE', simulated: true,  registeredAt: '2026-01-02' },
];

describe('DevicesComponent', () => {
  let component: DevicesComponent;
  let fixture: ComponentFixture<DevicesComponent>;
  let apiSpy: jasmine.SpyObj<ApiService>;
  let snackSpy: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('ApiService', [
      'getDevices', 'createDevice', 'deleteDevice', 'setSimulated',
      'getDeviceStats', 'sendTelemetry'
    ]);
    snackSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    apiSpy.getDevices.and.returnValue(of(mockDevices));
    apiSpy.getDeviceStats.and.returnValue(of({ deviceId: 'sensor-01', lastSeen: null }));

    await TestBed.configureTestingModule({
      imports: [DevicesComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: apiSpy },
        { provide: MatSnackBar, useValue: snackSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DevicesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load devices on init', () => {
    expect(component.devices.length).toBe(2);
    expect(component.filtered.length).toBe(2);
  });

  it('applySearch() should filter by deviceId', () => {
    component.search = 'sensor-01';
    component.applySearch();
    expect(component.filtered.length).toBe(1);
    expect(component.filtered[0].deviceId).toBe('sensor-01');
  });

  it('applySearch() should filter by type', () => {
    component.search = 'humidity';
    component.applySearch();
    expect(component.filtered.length).toBe(1);
  });

  it('applySearch() with empty string should return all devices', () => {
    component.search = '';
    component.applySearch();
    expect(component.filtered.length).toBe(2);
  });

  it('onlineCount should count devices with isOnline=true', () => {
    component.devices = [
      { ...mockDevices[0], isOnline: true },
      { ...mockDevices[1], isOnline: false },
    ] as any;
    expect(component.onlineCount).toBe(1);
  });

  it('create() should do nothing when newId is empty', () => {
    component.newId = '';
    component.newType = 'TEMPERATURE';
    component.create();
    expect(apiSpy.createDevice).not.toHaveBeenCalled();
  });

  it('create() should call api.createDevice and reload', () => {
    apiSpy.createDevice.and.returnValue(of({ deviceId: 'sensor-03' }));
    component.newId = 'sensor-03';
    component.newType = 'TEMPERATURE';
    component.create();
    expect(apiSpy.createDevice).toHaveBeenCalledWith('sensor-03', 'TEMPERATURE', false);
    expect(snackSpy.open).toHaveBeenCalled();
  });

  it('create() should show error snack on failure', () => {
    apiSpy.createDevice.and.returnValue(throwError(() => ({ status: 409, error: { message: 'Conflict' } })));
    component.newId = 'sensor-01';
    component.newType = 'TEMPERATURE';
    component.create();
    expect(snackSpy.open).toHaveBeenCalled();
    expect(component.creating).toBeFalse();
  });

  it('preset() normal should set sensor values', () => {
    component.preset('normal');
    expect(component.tTemp).toBe(22);
    expect(component.tHum).toBe(55);
    expect(component.tVib).toBe(0.01);
  });

  it('preset() warn should set sensor values', () => {
    component.preset('warn');
    expect(component.tTemp).toBe(75);
  });

  it('preset() critical should set sensor values', () => {
    component.preset('critical');
    expect(component.tTemp).toBe(115);
    expect(component.tHum).toBe(95);
    expect(component.tVib).toBe(8.0);
  });

  it('openTelemetry() should set telDevice and reset sensor defaults', () => {
    component.openTelemetry(mockDevices[0]);
    expect(component.telDevice).toEqual(mockDevices[0] as any);
    expect(component.tTemp).toBe(25);
    expect(component.tHum).toBe(60);
    expect(component.tVib).toBe(0.02);
  });

  it('closeTel() should clear telDevice', () => {
    component.telDevice = mockDevices[0] as any;
    component.closeTel();
    expect(component.telDevice).toBeNull();
  });

  it('sendTel() should call api.sendTelemetry and close modal', () => {
    apiSpy.sendTelemetry.and.returnValue(of({}));
    component.telDevice = mockDevices[0] as any;
    component.tTemp = 30;
    component.sendTel();
    expect(apiSpy.sendTelemetry).toHaveBeenCalledWith('sensor-01', 30, component.tHum, component.tVib);
    expect(component.telDevice).toBeNull();
  });

  it('deviceTooltip() should return no-telemetry message when lastSeen is null', () => {
    const d = { ...mockDevices[0], lastSeen: null } as any;
    expect(component.deviceTooltip(d)).toBe('No telemetry received');
  });

  it('deviceTooltip() should return last seen time when lastSeen is set', () => {
    const d = { ...mockDevices[0], lastSeen: Date.now() } as any;
    expect(component.deviceTooltip(d)).toContain('Last seen:');
  });
});
