"""
Entry point for the Spark Streaming service.

Reads from Kafka topic `device-data-processed`, enriches each event
with rolling window statistics, and writes to `device-data-enriched`.
"""
import logging

import config as settings
from streaming.processor import run_streaming

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)s  %(levelname)s  %(message)s",
)

if __name__ == "__main__":
    run_streaming(
        bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
        input_topic=settings.INPUT_TOPIC,
        output_topic=settings.OUTPUT_TOPIC,
        checkpoint_location=settings.CHECKPOINT_LOCATION,
        spark_master=settings.SPARK_MASTER,
    )
