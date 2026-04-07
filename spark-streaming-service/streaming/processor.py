"""
Spark Structured Streaming processor.

Pipeline
--------
Kafka (device-data-processed)
    → parse JSON
    → enrich with rolling window statistics (DeviceWindowState)
    → Kafka (device-data-enriched)

Architecture note
-----------------
All feature computation is delegated to streaming.features.DeviceWindowState
(pure Python / numpy — no Spark API). This keeps the business logic fully
unit-testable without a running SparkContext.
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql.functions import col, from_json
from confluent_kafka import Producer

import config as settings
from streaming.features import DeviceWindowState
from streaming.schemas import INPUT_SCHEMA

logger = logging.getLogger(__name__)

# Shared rolling state (survives across micro-batches within one JVM process)
_state: DeviceWindowState = DeviceWindowState(window_size=settings.WINDOW_SIZE)
_state_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Spark session factory
# ---------------------------------------------------------------------------

def create_spark_session(master: str = settings.SPARK_MASTER) -> SparkSession:
    return (
        SparkSession.builder
        .master(master)
        .appName("IoT-Spark-Streaming")
        .config("spark.sql.shuffle.partitions", "2")
        .config(
            "spark.jars.packages",
            "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1",
        )
        .getOrCreate()
    )


# ---------------------------------------------------------------------------
# Stream reader
# ---------------------------------------------------------------------------

def read_kafka_stream(
    spark: SparkSession,
    bootstrap_servers: str,
    topic: str,
) -> DataFrame:
    return (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", bootstrap_servers)
        .option("subscribe", topic)
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .load()
    )


def parse_events(df: DataFrame) -> DataFrame:
    return (
        df.select(
            from_json(col("value").cast("string"), INPUT_SCHEMA).alias("d")
        )
        .select("d.*")
        .filter(col("deviceId").isNotNull())
    )


# ---------------------------------------------------------------------------
# Per-row enrichment (pure Python — called from foreachBatch)
# ---------------------------------------------------------------------------

def _enrich_row(row: Any) -> dict[str, Any]:
    device_id    = row["deviceId"]
    enriched_raw = row["enrichedData"]

    reading = {
        "temperature": float(enriched_raw["temperature"] or 0.0),
        "humidity":    float(enriched_raw["humidity"]    or 0.0),
        "vibration":   float(enriched_raw["vibration"]   or 0.0),
    }

    with _state_lock:
        _state.update(device_id, reading)
        spark_features = _state.compute_features(device_id)

    return {
        "deviceId":  device_id,
        "eventId":   row["eventId"],
        "timestamp": row["timestamp"],
        "status":    row["status"],
        "enrichedData": {
            "temperature":    reading["temperature"],
            "humidity":       reading["humidity"],
            "vibration":      reading["vibration"],
            "deviceType":     enriched_raw["deviceType"],
            "deviceLocation": enriched_raw["deviceLocation"],
        },
        "sparkFeatures": spark_features,
    }


# ---------------------------------------------------------------------------
# foreachBatch sink
# ---------------------------------------------------------------------------

def make_batch_processor(producer_conf: dict[str, str], output_topic: str):
    """
    Returns a Spark foreachBatch function that enriches each event in the
    micro-batch with rolling window statistics and publishes to Kafka.
    """
    def process_batch(batch_df: DataFrame, batch_id: int) -> None:
        if batch_df.rdd.isEmpty():
            return

        rows    = batch_df.collect()
        enriched = [_enrich_row(r) for r in rows]

        producer = Producer(producer_conf)
        for event in enriched:
            producer.produce(output_topic, json.dumps(event).encode())
        producer.flush()

        logger.info(
            "Batch %d: published %d enriched events → %s",
            batch_id, len(enriched), output_topic,
        )

    return process_batch


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_streaming(
    bootstrap_servers: str,
    input_topic: str,
    output_topic: str,
    checkpoint_location: str,
    spark_master: str = settings.SPARK_MASTER,
) -> None:
    spark = create_spark_session(master=spark_master)
    spark.sparkContext.setLogLevel("WARN")

    raw_stream = read_kafka_stream(spark, bootstrap_servers, input_topic)
    parsed     = parse_events(raw_stream)

    producer_conf = {"bootstrap.servers": bootstrap_servers}

    query = (
        parsed.writeStream
        .foreachBatch(make_batch_processor(producer_conf, output_topic))
        .option("checkpointLocation", checkpoint_location)
        .trigger(processingTime="5 seconds")
        .start()
    )

    logger.info(
        "Spark Streaming started | %s → %s (checkpoint: %s)",
        input_topic, output_topic, checkpoint_location,
    )
    query.awaitTermination()
