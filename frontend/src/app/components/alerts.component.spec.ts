import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AlertsComponent } from './alerts.component';
import { ApiService } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

const mockAlerts = [
  { id: '1', deviceId: 'sensor-01', severity: 'HIGH',   message: 'Temp critical', timestamp: '2026-01-01T12:00:00Z', acknowledged: false },
  { id: '2', deviceId: 'sensor-02', severity: 'MEDIUM', message: 'Temp warning',  timestamp: '2026-01-01T11:00:00Z', acknowledged: false },
  { id: '3', deviceId: 'sensor-01', severity: 'LOW',    message: 'Low vibration', timestamp: '2026-01-01T10:00:00Z', acknowledged: true  },
];

describe('AlertsComponent', () => {
  let component: AlertsComponent;
  let fixture: ComponentFixture<AlertsComponent>;
  let apiSpy: jasmine.SpyObj<ApiService>;
  let snackSpy: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('ApiService', [
      'getAlerts', 'acknowledgeAlert', 'getTemperatureRule', 'setTemperatureRule'
    ]);
    snackSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    apiSpy.getAlerts.and.returnValue(of(mockAlerts));
    apiSpy.getTemperatureRule.and.returnValue(of(100));

    await TestBed.configureTestingModule({
      imports: [AlertsComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: apiSpy },
        { provide: MatSnackBar, useValue: snackSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AlertsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => component.ngOnDestroy());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load all alerts on init sorted newest first', () => {
    expect(component.all.length).toBe(3);
    expect(component.all[0].id).toBe('1');
  });

  it('should show all alerts with no filter applied', () => {
    expect(component.filtered.length).toBe(3);
  });

  it('setSev() should filter by severity', () => {
    component.setSev('HIGH');
    expect(component.filtered.length).toBe(1);
    expect(component.filtered[0].severity).toBe('HIGH');
  });

  it('setSev() with same severity should clear filter (toggle)', () => {
    component.setSev('HIGH');
    component.setSev('HIGH');
    expect(component.filtered.length).toBe(3);
  });

  it('setStatus() pending should show only unacknowledged', () => {
    component.setStatus('pending');
    expect(component.filtered.length).toBe(2);
    expect(component.filtered.every(a => !a.acknowledged)).toBeTrue();
  });

  it('setStatus() acked should show only acknowledged', () => {
    component.setStatus('acked');
    expect(component.filtered.length).toBe(1);
    expect(component.filtered[0].acknowledged).toBeTrue();
  });

  it('count() should return severity counts', () => {
    expect(component.count('HIGH')).toBe(1);
    expect(component.count('MEDIUM')).toBe(1);
    expect(component.count('LOW')).toBe(1);
  });

  it('ack() should call acknowledgeAlert and reload', () => {
    apiSpy.acknowledgeAlert.and.returnValue(of({}));
    component.ack('1');
    expect(apiSpy.acknowledgeAlert).toHaveBeenCalledWith('1');
    expect(snackSpy.open).toHaveBeenCalled();
  });

  it('ackAll() should acknowledge all pending alerts', () => {
    apiSpy.acknowledgeAlert.and.returnValue(of({}));
    component.ackAll();
    expect(apiSpy.acknowledgeAlert).toHaveBeenCalledTimes(2); // 2 pending
    expect(snackSpy.open).toHaveBeenCalled();
  });

  it('ackAll() should do nothing if no pending alerts', () => {
    component.all = [{ ...mockAlerts[2] }]; // only acknowledged
    component.ackAll();
    expect(apiSpy.acknowledgeAlert).not.toHaveBeenCalled();
  });

  it('loadThreshold() should set tempThreshold from API', () => {
    expect(component.tempThreshold).toBe(100);
    expect(component.tempThresholdEdit).toBe(100);
  });

  it('saveThreshold() should call setTemperatureRule', () => {
    apiSpy.setTemperatureRule.and.returnValue(of({}));
    component.tempThresholdEdit = 90;
    component.saveThreshold();
    expect(apiSpy.setTemperatureRule).toHaveBeenCalledWith(90);
    expect(snackSpy.open).toHaveBeenCalled();
  });

  it('saveThreshold() should do nothing when tempThresholdEdit is null', () => {
    component.tempThresholdEdit = null;
    component.saveThreshold();
    expect(apiSpy.setTemperatureRule).not.toHaveBeenCalled();
  });

  it('exportCsv() should do nothing when filtered is empty', () => {
    spyOn(document, 'createElement').and.callThrough();
    component.filtered = [];
    component.exportCsv();
    expect(snackSpy.open).not.toHaveBeenCalled();
  });

  it('exportCsv() should show snack with export count', () => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    spyOn(URL, 'revokeObjectURL');
    const anchor = document.createElement('a');
    spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor as any);

    component.exportCsv();
    expect(snackSpy.open).toHaveBeenCalled();
  });
});
