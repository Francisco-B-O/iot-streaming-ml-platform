package com.franciscobalonero.iotplatform.alert.controller;

import com.franciscobalonero.iotplatform.alert.dto.AlertDto;
import com.franciscobalonero.iotplatform.alert.service.AlertService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for managing alerts.
 * Provides endpoints for retrieving and acknowledging alerts.
 *
 * @author Francisco Balonero Olivera
 */
@RestController
@RequestMapping("/api/v1/alerts")
@RequiredArgsConstructor
@Tag(name = "Alert Management", description = "Endpoints for managing device alerts")
public class AlertController {

    private final AlertService alertService;

    /**
     * Retrieves all alerts registered in the system.
     *
     * @return A list of alert DTOs.
     */
    @GetMapping
    @Operation(summary = "Get all alerts", description = "Retrieves a list of all device alerts")
    public List<AlertDto> getAllAlerts() {
        return alertService.getAllAlerts();
    }

    /**
     * Acknowledges an alert by its ID.
     *
     * @param id The unique identifier of the alert.
     * @return The updated alert DTO.
     */
    @PutMapping("/{id}/acknowledge")
    @Operation(summary = "Acknowledge alert", description = "Marks a specific alert as acknowledged")
    public AlertDto acknowledgeAlert(@PathVariable UUID id) {
        return alertService.acknowledgeAlert(id);
    }
}
