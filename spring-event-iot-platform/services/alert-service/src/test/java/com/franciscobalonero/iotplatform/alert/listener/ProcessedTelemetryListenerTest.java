package com.franciscobalonero.iotplatform.alert.listener;

import com.franciscobalonero.iotplatform.alert.model.Alert;
import com.franciscobalonero.iotplatform.alert.repository.AlertRepository;
import com.franciscobalonero.iotplatform.common.event.AlertCreatedEvent;
import com.franciscobalonero.iotplatform.common.event.ProcessedTelemetryEvent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link ProcessedTelemetryListener}.
 * This class verifies the behavior of the telemetry listener in response to different event statuses.
 *
 * @author Francisco Balonero Olivera
 */
@ExtendWith(MockitoExtension.class)
class ProcessedTelemetryListenerTest {

    @Mock
    private AlertRepository alertRepository;

    @Mock
    private KafkaTemplate<String, AlertCreatedEvent> kafkaTemplate;

    @InjectMocks
    private ProcessedTelemetryListener listener;

    /**
     * Verifies that an alert is created and published when the telemetry status is "CRITICAL".
     */
    @Test
    void shouldCreateAlertWhenStatusIsCritical() {
        ProcessedTelemetryEvent event = ProcessedTelemetryEvent.builder()
                .deviceId("sensor-1")
                .status("CRITICAL")
                .enrichedData(Map.of("temp", 45.0))
                .build();

        Alert savedAlert = Alert.builder()
                .id(UUID.randomUUID())
                .deviceId("sensor-1")
                .severity("HIGH")
                .build();

        when(alertRepository.save(any(Alert.class))).thenReturn(savedAlert);

        listener.handleProcessedTelemetry(event);

        verify(alertRepository, times(1)).save(any(Alert.class));
        verify(kafkaTemplate, times(1)).send(eq("alert-created"), eq("sensor-1"), any(AlertCreatedEvent.class));
    }

    /**
     * Verifies that a MEDIUM alert is created and published when the telemetry status is "WARNING".
     */
    @Test
    void shouldCreateMediumAlertWhenStatusIsWarning() {
        ProcessedTelemetryEvent event = ProcessedTelemetryEvent.builder()
                .deviceId("sensor-1")
                .status("WARNING")
                .enrichedData(Map.of("temperature", 85.0))
                .build();

        Alert savedAlert = Alert.builder()
                .id(UUID.randomUUID())
                .deviceId("sensor-1")
                .severity("MEDIUM")
                .build();

        when(alertRepository.save(any(Alert.class))).thenReturn(savedAlert);

        listener.handleProcessedTelemetry(event);

        ArgumentCaptor<Alert> alertCaptor = ArgumentCaptor.forClass(Alert.class);
        verify(alertRepository, times(1)).save(alertCaptor.capture());
        assertThat(alertCaptor.getValue().getSeverity()).isEqualTo("MEDIUM");
        verify(kafkaTemplate, times(1)).send(eq("alert-created"), eq("sensor-1"), any(AlertCreatedEvent.class));
    }

    /**
     * Verifies that no alert is created when the telemetry status is "NORMAL".
     */
    @Test
    void shouldNotCreateAlertWhenStatusIsNormal() {
        ProcessedTelemetryEvent event = ProcessedTelemetryEvent.builder()
                .deviceId("sensor-1")
                .status("NORMAL")
                .build();

        listener.handleProcessedTelemetry(event);

        verify(alertRepository, never()).save(any());
        verify(kafkaTemplate, never()).send(anyString(), anyString(), any());
    }
}
