"""
Kafka consumer for the IoT ML Platform.
Consumes telemetry events, enriches them with ML predictions, and stores them in the data lake.
"""

import json
import logging
import os
import time
from typing import Dict, Any, Optional

from confluent_kafka import Consumer, KafkaException, Message, KafkaError

from config.settings import settings
from storage.data_lake import data_lake
from ml.predict import predictor
from ml.kafka_producer import ml_producer
from ml import shared_state

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class KafkaIngestor:
    """
    Handles consumption of events from Kafka and orchestration of ML processing and storage.
    """
    def __init__(self):
        """
        Initializes the Kafka consumer with settings from the configuration.
        """
        self.conf = {
            'bootstrap.servers': settings.KAFKA_BOOTSTRAP_SERVERS,
            'group.id': settings.KAFKA_GROUP_ID,
            'auto.offset.reset': os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest')
        }
        try:
            self.consumer = Consumer(self.conf)
            self.topics = settings.KAFKA_CONSUME_TOPICS
        except Exception as e:
            logger.error(f"Failed to initialize Kafka consumer: {e}")
            raise

    def process_event_with_ml(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes a single event with ML, updates data, and produces results.

        Args:
            event_data (Dict[str, Any]): The raw telemetry event data.

        Returns:
            Dict[str, Any]: The enriched event data.
        """
        try:
            is_anomaly, score = predictor.predict_anomaly(event_data)

            # Enrich event data with ML results before storage
            event_data['anomaly_score'] = score
            event_data['is_anomaly'] = is_anomaly

            # Produce prediction back to Kafka
            ml_producer.produce_prediction(event_data, is_anomaly, score)

            # Append to shared prediction history (read by /anomaly-stats API)
            with shared_state.history_lock:
                shared_state.prediction_history.append({
                    "device_id": event_data.get("deviceId", "unknown"),
                    "timestamp": event_data.get("timestamp", ""),
                    "is_anomaly": is_anomaly,
                    "score": score,
                })

            if is_anomaly:
                logger.warning(f"ANOMALY DETECTED for device {event_data.get('deviceId')}: Score {score}")
                ml_producer.produce_anomaly(event_data, is_anomaly, score)
            else:
                logger.info(f"Normal event for device {event_data.get('deviceId')}: Score {score}")

            return event_data

        except Exception as e:
            logger.error(f"Error in ML processing: {e}", exc_info=True)
            # Return original data if enrichment fails to avoid data loss in lake
            return event_data

    def subscribe_with_retry(self, max_retries: int = 30, retry_delay: int = 2):
        """
        Subscribe to Kafka topics with retry logic for handling topic unavailability.

        Args:
            max_retries: Maximum number of subscription attempts
            retry_delay: Delay in seconds between retry attempts
        """
        retries = 0
        while retries < max_retries:
            try:
                self.consumer.subscribe(self.topics)
                logger.info(f"Successfully subscribed to topics: {self.topics}")
                return
            except Exception as e:
                retries += 1
                logger.warning(f"Subscription attempt {retries}/{max_retries} failed: {e}")
                if retries < max_retries:
                    logger.info(f"Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)

        logger.error(f"Failed to subscribe to topics after {max_retries} attempts")
        raise RuntimeError(f"Unable to subscribe to Kafka topics: {self.topics}")

    def consume_events(self):
        """
        Consumes events from Kafka, runs ML, and stores them with enriched data.
        Continuously polls Kafka for new messages with automatic recovery.
        """
        # Subscribe with retry logic
        self.subscribe_with_retry()

        error_count = 0
        max_consecutive_errors = 10

        try:
            while True:
                try:
                    msg: Optional[Message] = self.consumer.poll(timeout=1.0)
                    if msg is None:
                        continue

                    if msg.error():
                        error_code = msg.error().code()
                        logger.error(f"Kafka error: {msg.error()}")

                        # Handle partition EOF gracefully
                        if error_code == KafkaError._PARTITION_EOF:
                            continue
                        # Handle unknown topic with backoff
                        elif error_code in [KafkaError.UNKNOWN_TOPIC_OR_PART, KafkaError.COORDINATOR_NOT_AVAILABLE]:
                            error_count += 1
                            if error_count < max_consecutive_errors:
                                logger.warning(f"Topic not available, retrying... ({error_count}/{max_consecutive_errors})")
                                time.sleep(2)
                                continue
                            else:
                                raise KafkaException(msg.error())
                        else:
                            raise KafkaException(msg.error())

                    # Reset error count on successful message
                    error_count = 0

                    try:
                        if msg.value() is None:
                            continue
                        raw_value = msg.value().decode('utf-8')
                        event_data = json.loads(raw_value)
                        logger.debug(f"Received event: {event_data.get('eventId', 'unknown')}")

                        # 1. Run ML (Real-time scoring)
                        enriched_event = self.process_event_with_ml(event_data)

                        # 2. Store enriched event in Data Lake
                        data_lake.store_event(enriched_event)

                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to decode message JSON: {e}")
                    except Exception as e:
                        logger.error(f"Error processing message: {e}", exc_info=True)

                except KafkaException as e:
                    logger.error(f"Kafka exception in consumer loop: {e}")
                    # Attempt to recover by sleeping and retrying
                    logger.info("Attempting recovery after Kafka exception...")
                    time.sleep(5)
                    if error_count >= max_consecutive_errors:
                        raise

        except Exception as e:
            logger.critical(f"Fatal error in consumer loop: {e}", exc_info=True)
            raise
        finally:
            logger.info("Closing Kafka consumer.")
            self.consumer.close()

if __name__ == "__main__":
    ingestor = KafkaIngestor()
    ingestor.consume_events()
