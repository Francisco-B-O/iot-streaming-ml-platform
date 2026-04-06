package com.franciscobalonero.iotplatform.processing.listener;

import com.franciscobalonero.iotplatform.common.event.DeviceTelemetryEvent;
import com.franciscobalonero.iotplatform.common.event.ProcessedTelemetryEvent;
import com.franciscobalonero.iotplatform.processing.client.DeviceClient;
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
import static org.mockito.ArgumentMatchers.anyString;
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
    private KafkaTemplate<String, ProcessedTelemetryEvent> kafkaTemplate;

    @InjectMocks
    private TelemetryListener telemetryListener;

    /**
     * Verifies that critical telemetry is correctly processed, enriched, and published with the proper status.
     */
    @Test
    void shouldProcessCriticalTelemetry() {
        DeviceTelemetryEvent event = DeviceTelemetryEvent.builder()
                .eventId(UUID.randomUUID())
                .deviceId("sensor-1")
                .payload(Map.of("temperature", 45.0))
                .build();

        DeviceClient.DeviceResponse deviceResponse = new DeviceClient.DeviceResponse();
        deviceResponse.setDeviceId("sensor-1");
        deviceResponse.setType("TEMP_SENSOR");

        when(deviceClient.getDeviceById("sensor-1")).thenReturn(Optional.of(deviceResponse));

        telemetryListener.handleTelemetry(event);

        ArgumentCaptor<ProcessedTelemetryEvent> captor = ArgumentCaptor.forClass(ProcessedTelemetryEvent.class);
        verify(kafkaTemplate).send(eq("device-data-processed"), eq("sensor-1"), captor.capture());

        assertThat(captor.getValue().getStatus()).isEqualTo("CRITICAL");
        assertThat(captor.getValue().getEnrichedData()).containsEntry("deviceType", "TEMP_SENSOR");
    }
}
