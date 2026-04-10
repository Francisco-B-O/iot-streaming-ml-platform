"""
Shared in-memory state for ML predictions, accessible by both the Kafka consumer
thread and the FastAPI request handlers.
"""
import threading
from collections import deque

# Prediction history (last 500 entries) populated by the Kafka consumer
prediction_history: deque = deque(maxlen=500)
history_lock = threading.Lock()

# Auto-retrain configuration
autotrain_config: dict = {"enabled": False, "interval_hours": 6.0}
autotrain_lock = threading.Lock()

# Last train time (epoch seconds)
last_train_time: float | None = None
