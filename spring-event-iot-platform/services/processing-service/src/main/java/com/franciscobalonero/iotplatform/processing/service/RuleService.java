package com.franciscobalonero.iotplatform.processing.service;

import com.franciscobalonero.iotplatform.processing.model.Rule;
import com.franciscobalonero.iotplatform.processing.repository.RuleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service class for managing processing rules and thresholds.
 * Centralizes the rule state and business logic for the processing service.
 * Rules are automatically initialized via RuleInitializer after application startup.
 *
 * @author Francisco Balonero Olivera
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RuleService {

    private final RuleRepository ruleRepository;
    private static final double DEFAULT_TEMPERATURE_THRESHOLD = 100.0;
    private volatile boolean initialized = false;

    /**
     * Lazy initialization of default rules - executes on first use of getTemperatureThreshold()
     */
    private void ensureInitialized() {
        if (!initialized) {
            synchronized (this) {
                if (!initialized) {
                    try {
                        if (ruleRepository.findByMetric("temperature").isEmpty()) {
                            Rule defaultRule = Rule.builder()
                                    .ruleName("Default Temperature Check")
                                    .metric("temperature")
                                    .threshold(DEFAULT_TEMPERATURE_THRESHOLD)
                                    .description("Default threshold for temperature anomalies")
                                    .build();
                            ruleRepository.save(defaultRule);
                            log.info("Initialized default temperature rule");
                        }
                    } catch (Exception e) {
                        log.warn("Error initializing default rules: {}. Using fallback threshold.", e.getMessage());
                    } finally {
                        initialized = true;
                    }
                }
            }
        }
    }

    /**
     * Updates the current temperature threshold.
     *
     * @param threshold The new threshold value.
     */
    @Transactional
    public void updateTemperatureThreshold(double threshold) {
        try {
            log.info("Updating temperature threshold to: {}", threshold);
            Rule rule = ruleRepository.findByMetric("temperature")
                    .orElseGet(() -> Rule.builder()
                            .metric("temperature")
                            .ruleName("Dynamic Temperature Check")
                            .build());
            rule.setThreshold(threshold);
            rule.setRuleName("Dynamic Temperature Check");
            ruleRepository.save(rule);
        } catch (Exception e) {
            log.warn("Error updating temperature threshold: {}", e.getMessage());
        }
    }

    /**
     * Retrieves the current temperature threshold.
     * Returns the default threshold if no rule is found or if an error occurs.
     * Lazily initializes default rules on first call.
     *
     * @return The temperature threshold value.
     */
    @Transactional(readOnly = true)
    public double getTemperatureThreshold() {
        ensureInitialized();
        try {
            return ruleRepository.findByMetric("temperature")
                    .map(Rule::getThreshold)
                    .orElse(DEFAULT_TEMPERATURE_THRESHOLD);
        } catch (Exception e) {
            log.warn("Error retrieving temperature threshold: {}. Using default threshold.", e.getMessage());
            return DEFAULT_TEMPERATURE_THRESHOLD;
        }
    }
}
