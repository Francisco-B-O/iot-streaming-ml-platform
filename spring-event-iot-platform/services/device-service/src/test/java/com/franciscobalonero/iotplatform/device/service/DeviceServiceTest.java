package com.franciscobalonero.iotplatform.device.service;

import com.franciscobalonero.iotplatform.device.dto.CreateDeviceRequest;
import com.franciscobalonero.iotplatform.device.dto.DeviceDto;
import com.franciscobalonero.iotplatform.device.mapper.DeviceMapper;
import com.franciscobalonero.iotplatform.device.model.Device;
import com.franciscobalonero.iotplatform.device.repository.DeviceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link DeviceService}.
 * Mocks dependencies to verify the business logic for device management.
 *
 * @author Francisco Balonero Olivera
 */
@ExtendWith(MockitoExtension.class)
class DeviceServiceTest {

    @Mock
    private DeviceRepository deviceRepository;

    @Mock
    private DeviceMapper deviceMapper;

    @InjectMocks
    private DeviceService deviceService;

    /**
     * Verifies that a device registration request is correctly processed and results in a saved device DTO.
     */
    @Test
    void shouldCreateDevice() {
        CreateDeviceRequest request = CreateDeviceRequest.builder()
                .deviceId("sensor-1")
                .type("TEMP")
                .build();

        Device device = Device.builder()
                .id(UUID.randomUUID())
                .deviceId("sensor-1")
                .build();

        DeviceDto dto = DeviceDto.builder()
                .deviceId("sensor-1")
                .build();

        when(deviceRepository.findByDeviceId("sensor-1")).thenReturn(Optional.empty());
        when(deviceMapper.toEntity(any())).thenReturn(device);
        when(deviceRepository.save(any())).thenReturn(device);
        when(deviceMapper.toDto(any())).thenReturn(dto);

        DeviceDto result = deviceService.createDevice(request);

        assertThat(result.getDeviceId()).isEqualTo("sensor-1");
    }
}
