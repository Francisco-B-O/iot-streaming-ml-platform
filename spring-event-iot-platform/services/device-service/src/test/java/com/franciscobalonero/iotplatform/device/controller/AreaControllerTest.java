package com.franciscobalonero.iotplatform.device.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.franciscobalonero.iotplatform.device.dto.AreaRequest;
import com.franciscobalonero.iotplatform.device.dto.AreaResponse;
import com.franciscobalonero.iotplatform.device.service.AreaService;
import com.franciscobalonero.iotplatform.common.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web layer tests for {@link AreaController}.
 */
@WebMvcTest(AreaController.class)
class AreaControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AreaService areaService;

    private static final List<List<Double>> POLYGON =
            List.of(List.of(40.0, -3.0), List.of(40.1, -3.0), List.of(40.1, -3.1));

    @Test
    void shouldReturnAllAreas() throws Exception {
        AreaResponse area = AreaResponse.builder()
                .id(UUID.randomUUID()).name("Zone A").polygon(POLYGON).deviceCount(2)
                .deviceIds(List.of("d1", "d2"))
                .build();
        when(areaService.getAllAreas()).thenReturn(List.of(area));

        mockMvc.perform(get("/api/v1/areas"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Zone A"))
                .andExpect(jsonPath("$[0].deviceCount").value(2));
    }

    @Test
    void shouldCreateArea() throws Exception {
        AreaRequest request = new AreaRequest("New Zone", POLYGON);
        AreaResponse response = AreaResponse.builder()
                .id(UUID.randomUUID()).name("New Zone").polygon(POLYGON).deviceCount(0)
                .build();
        when(areaService.createArea(any())).thenReturn(response);

        mockMvc.perform(post("/api/v1/areas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("New Zone"));
    }

    @Test
    void shouldRejectCreateAreaWithoutName() throws Exception {
        String body = objectMapper.writeValueAsString(new AreaRequest("", POLYGON));

        mockMvc.perform(post("/api/v1/areas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldRejectCreateAreaWithTooFewPoints() throws Exception {
        AreaRequest request = new AreaRequest("Bad Zone", List.of(List.of(40.0, -3.0)));
        mockMvc.perform(post("/api/v1/areas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldDeleteArea() throws Exception {
        UUID id = UUID.randomUUID();
        doNothing().when(areaService).deleteArea(id);

        mockMvc.perform(delete("/api/v1/areas/" + id))
                .andExpect(status().isNoContent());

        verify(areaService).deleteArea(id);
    }

    @Test
    void shouldReturn404WhenDeletingNonExistentArea() throws Exception {
        UUID id = UUID.randomUUID();
        doThrow(new ResourceNotFoundException("Area " + id + " not found"))
                .when(areaService).deleteArea(id);

        mockMvc.perform(delete("/api/v1/areas/" + id))
                .andExpect(status().isNotFound());
    }

    @Test
    void shouldRejectCreateAreaWithInvalidCoordinatePairs() throws Exception {
        // Each point must have exactly 2 elements — sending a 1-element point
        AreaRequest request = new AreaRequest("Bad Zone",
                List.of(List.of(40.0), List.of(40.1, -3.0), List.of(40.2, -3.1)));
        mockMvc.perform(post("/api/v1/areas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldAssignDeviceToArea() throws Exception {
        UUID areaId = UUID.randomUUID();
        AreaResponse response = AreaResponse.builder()
                .id(areaId).name("Zone").polygon(POLYGON).deviceCount(1)
                .deviceIds(List.of("sensor-01"))
                .build();
        when(areaService.assignDevice(eq(areaId), eq("sensor-01"))).thenReturn(response);

        mockMvc.perform(post("/api/v1/areas/" + areaId + "/devices/sensor-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deviceCount").value(1))
                .andExpect(jsonPath("$.deviceIds[0]").value("sensor-01"));
    }
}
