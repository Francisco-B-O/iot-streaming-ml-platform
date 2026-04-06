package com.franciscobalonero.iotplatform.alert.listener;

import com.franciscobalonero.iotplatform.alert.model.Alert;
import com.franciscobalonero.iotplatform.alert.repository.AlertRepository;
import com.franciscobalonero.iotplatform.common.event.AlertCreatedEvent;
import com.franciscobalonero.iotplatform.common.event.ProcessedTelemetryEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * Kafka listener component responsible for processing enriched telemetry events.
 * This listener monitors telemetry status and triggers the creation of alerts for critical conditions.
 *
 * @author Francisco Balonero Olivera
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ProcessedTelemetryListener {

    private final AlertRepository alertRepository;
    private final KafkaTemplate<String, AlertCreatedEvent> kafkaTemplate;
    private static final String ALERT_TOPIC = "alert-created";

    /**
     * Handles processed telemetry events received from Kafka.
     * If the telemetry status is "CRITICAL", it generates an alert and publishes an {@link AlertCreatedEvent}.
     *
     * @param event The processed telemetry event containing device ID, status, and enriched data.
     */
    @KafkaListener(topics = "device-data-processed", groupId = "alert-group")
    public void handleProcessedTelemetry(ProcessedTelemetryEvent event) {
        log.info("Checking for alerts in telemetry from device: {}", event.getDeviceId());

        String severity = null;
        String message = null;

        if ("CRITICAL".equals(event.getStatus())) {
            severity = "HIGH";
            message = String.format("Critical temperature detected for device %s. Data: %s",
                    event.getDeviceId(), event.getEnrichedData());
            log.warn("CRITICAL status detected for device: {}. Creating HIGH alert.", event.getDeviceId());
        } else if ("WARNING".equals(event.getStatus())) {
            severity = "MEDIUM";
            message = String.format("Warning temperature threshold approached for device %s. Data: %s",
                    event.getDeviceId(), event.getEnrichedData());
            log.warn("WARNING status detected for device: {}. Creating MEDIUM alert.", event.getDeviceId());
        }

        if (severity != null) {
            Alert alert = Alert.builder()
                    .deviceId(event.getDeviceId())
                    .severity(severity)
                    .message(message)
                    .timestamp(LocalDateTime.now(ZoneOffset.UTC))
                    .acknowledged(false)
                    .build();

            Alert savedAlert = alertRepository.save(alert);

            AlertCreatedEvent alertEvent = AlertCreatedEvent.builder()
                    .eventId(UUID.randomUUID())
                    .correlationId(event.getCorrelationId())
                    .eventType("AlertCreatedEvent")
                    .timestamp(Instant.now())
                    .sourceService("alert-service")
                    .alertId(savedAlert.getId())
                    .deviceId(savedAlert.getDeviceId())
                    .severity(savedAlert.getSeverity())
                    .message(savedAlert.getMessage())
                    .build();

            kafkaTemplate.send(ALERT_TOPIC, alertEvent.getDeviceId(), alertEvent);
            log.info("Alert created and published: {} (severity: {})", alertEvent.getAlertId(), severity);
        }
    }
}
