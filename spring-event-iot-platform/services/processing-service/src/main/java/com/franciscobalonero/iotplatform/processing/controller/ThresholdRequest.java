package com.franciscobalonero.iotplatform.processing.controller;

import lombok.Data;

/**
 * Data Transfer Object for threshold update requests.
 *
 * @author Francisco Balonero Olivera
 */
@Data
public class ThresholdRequest {
    /**
     * The new threshold value to be applied.
     */
    private double threshold;
}
