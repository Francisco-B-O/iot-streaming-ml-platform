package com.franciscobalonero.iotplatform.processing.listener;

import com.franciscobalonero.iotplatform.common.event.DeviceTelemetryEvent;
import com.franciscobalonero.iotplatform.common.event.ProcessedTelemetryEvent;
import com.franciscobalonero.iotplatform.processing.client.DeviceClient;
import com.franciscobalonero.iotplatform.processing.model.IdempotencyRecord;
import com.franciscobalonero.iotplatform.processing.repository.IdempotencyRecordRepository;
import com.franciscobalonero.iotplatform.processing.service.RuleService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link TelemetryListener}.
 * Verifies the processing and enrichment logic for incoming telemetry data.
 *
 * @author Francisco Balonero Olivera
 */
@ExtendWith(MockitoExtension.class)
class TelemetryListenerTest {

    @Mock
    private DeviceClient deviceClient;

    @Mock
    private RuleService ruleService;

    @Mock
    private IdempotencyRecordRepository idempotencyRecordRepository;

    @Mock
    private KafkaTemplate<String, ProcessedTelemetryEvent> kafkaTemplate;

    @InjectMocks
    private TelemetryListener telemetryListener;

    /**
     * Verifies that critical telemetry is correctly processed, enriched, and published with the proper status.
     * Temperature 115°C exceeds the 100°C threshold → CRITICAL.
     */
    @Test
    void shouldProcessCriticalTelemetry() {
        DeviceTelemetryEvent event = DeviceTelemetryEvent.builder()
                .eventId(UUID.randomUUID())
                .deviceId("sensor-1")
                .payload(Map.of("temperature", 115.0))
                .build();

        DeviceClient.DeviceResponse deviceResponse = new DeviceClient.DeviceResponse();
        deviceResponse.setDeviceId("sensor-1");
        deviceResponse.setType("TEMP_SENSOR");

        when(idempotencyRecordRepository.existsById(any())).thenReturn(false);
        when(idempotencyRecordRepository.save(any(IdempotencyRecord.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(deviceClient.getDeviceById("sensor-1")).thenReturn(Optional.of(deviceResponse));
        when(ruleService.getTemperatureThreshold()).thenReturn(100.0);

        telemetryListener.handleTelemetry(event);

        ArgumentCaptor<ProcessedTelemetryEvent> captor = ArgumentCaptor.forClass(ProcessedTelemetryEvent.class);
        verify(kafkaTemplate).send(eq("device-data-processed"), eq("sensor-1"), captor.capture());

        assertThat(captor.getValue().getStatus()).isEqualTo("CRITICAL");
        assertThat(captor.getValue().getEnrichedData()).containsEntry("deviceType", "TEMP_SENSOR");
    }

    /**
     * Verifies that duplicate events are skipped (idempotency check).
     */
    @Test
    void shouldSkipDuplicateEvent() {
        UUID eventId = UUID.randomUUID();
        DeviceTelemetryEvent event = DeviceTelemetryEvent.builder()
                .eventId(eventId)
                .deviceId("sensor-1")
                .payload(Map.of("temperature", 25.0))
                .build();

        when(idempotencyRecordRepository.existsById(eventId)).thenReturn(true);

        telemetryListener.handleTelemetry(event);

        // No message should be published
        verify(kafkaTemplate, org.mockito.Mockito.never())
                .send(any(), any(), any(ProcessedTelemetryEvent.class));
    }

    /**
     * Verifies warning status when temperature is between 80% and 100% of the threshold.
     * Temperature 85°C with threshold 100°C → 85 > 80 (100*0.8) → WARNING.
     */
    @Test
    void shouldProcessWarningTelemetry() {
        DeviceTelemetryEvent event = DeviceTelemetryEvent.builder()
                .eventId(UUID.randomUUID())
                .deviceId("sensor-1")
                .payload(Map.of("temperature", 85.0))
                .build();

        DeviceClient.DeviceResponse deviceResponse = new DeviceClient.DeviceResponse();
        deviceResponse.setDeviceId("sensor-1");
        deviceResponse.setType("TEMP_SENSOR");

        when(idempotencyRecordRepository.existsById(any())).thenReturn(false);
        when(idempotencyRecordRepository.save(any(IdempotencyRecord.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(deviceClient.getDeviceById("sensor-1")).thenReturn(Optional.of(deviceResponse));
        when(ruleService.getTemperatureThreshold()).thenReturn(100.0);

        telemetryListener.handleTelemetry(event);

        ArgumentCaptor<ProcessedTelemetryEvent> captor = ArgumentCaptor.forClass(ProcessedTelemetryEvent.class);
        verify(kafkaTemplate).send(eq("device-data-processed"), eq("sensor-1"), captor.capture());

        assertThat(captor.getValue().getStatus()).isEqualTo("WARNING");
    }
}
