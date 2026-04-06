package com.franciscobalonero.iotplatform.device.service;

import com.franciscobalonero.iotplatform.device.dto.CreateDeviceRequest;
import com.franciscobalonero.iotplatform.device.dto.DeviceDto;
import com.franciscobalonero.iotplatform.device.mapper.DeviceMapper;
import com.franciscobalonero.iotplatform.device.model.Device;
import com.franciscobalonero.iotplatform.device.repository.DeviceRepository;
import com.franciscobalonero.iotplatform.common.exception.ConflictException;
import com.franciscobalonero.iotplatform.common.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Service class for managing device business logic.
 * Handles device registration, retrieval, and deletion operations.
 *
 * @author Francisco Balonero Olivera
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DeviceService {

    private final DeviceRepository deviceRepository;
    private final DeviceMapper deviceMapper;

    /**
     * Retrieves all registered devices.
     *
     * @return A list of all devices as DTOs.
     */
    @Transactional(readOnly = true)
    public List<DeviceDto> getAllDevices() {
        return deviceMapper.toDtoList(deviceRepository.findAll());
    }

    /**
     * Retrieves a device by its unique device identifier.
     *
     * @param deviceId The unique identifier of the device.
     * @return An optional containing the device DTO if found.
     */
    @Transactional(readOnly = true)
    public Optional<DeviceDto> getDeviceById(String deviceId) {
        return deviceRepository.findByDeviceId(deviceId)
                .map(deviceMapper::toDto);
    }

    /**
     * Creates a new device registration.
     *
     * @param request The request containing device registration details.
     * @return The saved device DTO.
     * @throws ConflictException if a device with the same ID already exists.
     */
    @Transactional
    public DeviceDto createDevice(CreateDeviceRequest request) {
        log.info("Creating device with ID: {}", request.getDeviceId());
        
        if (deviceRepository.findByDeviceId(request.getDeviceId()).isPresent()) {
            throw new ConflictException("Device with ID " + request.getDeviceId() + " already exists");
        }

        Device device = deviceMapper.toEntity(request);
        Device savedDevice = deviceRepository.save(device);
        return deviceMapper.toDto(savedDevice);
    }

    /**
     * Deletes a device registration by its device identifier.
     *
     * @param deviceId The unique identifier of the device to delete.
     * @throws ResourceNotFoundException if the device is not found.
     */
    @Transactional
    public void deleteDevice(String deviceId) {
        log.info("Deleting device with ID: {}", deviceId);
        Device device = deviceRepository.findByDeviceId(deviceId)
                .orElseThrow(() -> new ResourceNotFoundException("Device with ID " + deviceId + " not found"));
        deviceRepository.delete(device);
    }

    /**
     * Enables or disables simulation for a device.
     *
     * @param deviceId The unique identifier of the device.
     * @param simulated Whether the device should be simulated.
     * @return The updated device DTO.
     * @throws ResourceNotFoundException if the device is not found.
     */
    @Transactional
    public DeviceDto setSimulated(String deviceId, boolean simulated) {
        log.info("Setting simulated={} for device: {}", simulated, deviceId);
        Device device = deviceRepository.findByDeviceId(deviceId)
                .orElseThrow(() -> new ResourceNotFoundException("Device with ID " + deviceId + " not found"));
        device.setSimulated(simulated);
        return deviceMapper.toDto(deviceRepository.save(device));
    }
}
