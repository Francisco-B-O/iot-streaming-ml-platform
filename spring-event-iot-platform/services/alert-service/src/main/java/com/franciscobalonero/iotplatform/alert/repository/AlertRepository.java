package com.franciscobalonero.iotplatform.alert.repository;

import com.franciscobalonero.iotplatform.alert.model.Alert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Repository interface for {@link Alert} entities.
 * Provides standard CRUD operations and custom query methods for managing alerts in the database.
 *
 * @author Francisco Balonero Olivera
 */
@Repository
public interface AlertRepository extends JpaRepository<Alert, UUID> {
}
