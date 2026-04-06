"""
Anomaly prediction module for the IoT ML Platform.

Uses a pre-trained Isolation Forest model to score telemetry events.

ROOT CAUSE NOTE — why single-event inference broke:
  The model was trained on rolling-window features (mean, std, min, max, delta
  over a 5-event window per device). When a single event is processed:
    - rolling_std  collapses to 0        (no variance in a window of 1)
    - rolling_min/max collapse to the raw value  (same as mean)
    - delta        collapses to 0        (no previous value)
  These degenerate feature vectors look nothing like the training distribution,
  causing the model to flag everything as anomalous.

FIX — windowed inference:
  Before scoring, we fetch the last (window_size - 1) historical events for the
  device from the data lake and prepend them to the current event. This gives
  data_processor.prepare_for_ml a proper time-ordered sequence, so rolling
  features are computed with real variance, matching the training distribution.
"""

import os
import logging
import json
from typing import Any

import joblib
import pandas as pd

from config.settings import settings
from processing.data_processor import data_processor

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Window size must match what was used during training (rolling(window=5))
INFERENCE_WINDOW_SIZE = 5

# Columns needed by prepare_for_ml — used to strip irrelevant columns when
# merging historical events (which may carry extra fields like anomaly_score)
_BASE_COLS = {'deviceId', 'timestamp'}


def _keep_ml_cols(df: pd.DataFrame) -> pd.DataFrame:
    """Return only columns that prepare_for_ml cares about."""
    keep = [c for c in df.columns
            if c in _BASE_COLS or c.startswith('enrichedData.')]
    return df[keep]


class AnomalyPredictor:
    """
    Predicts anomalies in telemetry data using a loaded, versioned ML model.

    Inference is always windowed: the predictor fetches recent events for the
    device from the data lake so that rolling features are computed over a proper
    time sequence rather than a degenerate single-row window.
    """

    def __init__(self, model_path: str | None = None):
        self.model_path = model_path or settings.MODEL_STORAGE_PATH
        self.latest_info_file = os.path.join(self.model_path, "latest_model.json")
        self.model = None
        self.feature_names: list[str] | None = None
        self.current_version: str | None = None
        # Default fallback — overridden by model metadata when available
        self.threshold: float = settings.ANOMALY_THRESHOLD
        self.load_model()

    def load_model(self):
        """Load the latest trained model and its computed threshold."""
        try:
            if os.path.exists(self.latest_info_file):
                with open(self.latest_info_file) as f:
                    latest_info = json.load(f)

                version = latest_info["latest_version"]
                version_dir = os.path.join(self.model_path, version)
                model_file = os.path.join(version_dir, "anomaly_detector.joblib")
                feature_file = os.path.join(version_dir, "feature_names.joblib")

                if os.path.exists(model_file) and os.path.exists(feature_file):
                    self.model = joblib.load(model_file)
                    self.feature_names = joblib.load(feature_file)
                    self.current_version = version

                    # Use the threshold computed from the training score distribution
                    # (saved by train_model.py). Falls back to settings if absent.
                    if "threshold" in latest_info.get("metrics", {}):
                        self.threshold = latest_info["metrics"]["threshold"]
                        logger.info(
                            f"Model {version} loaded. "
                            f"Threshold from training data: {self.threshold:.4f}"
                        )
                    else:
                        logger.info(
                            f"Model {version} loaded. "
                            f"Using fallback threshold: {self.threshold:.4f}"
                        )
                else:
                    logger.warning(f"Model files not found for version {version}")
            else:
                logger.warning("No latest_model.json found. Predictions unavailable.")
        except Exception as e:
            logger.error(f"Error loading model: {e}", exc_info=True)
            self.model = None

    # ------------------------------------------------------------------
    # Windowed inference helpers
    # ------------------------------------------------------------------

    def _build_inference_window(
        self, event_data: dict[str, Any]
    ) -> pd.DataFrame:
        """
        Build a chronologically ordered window of events for feature computation.

        Fetches up to (INFERENCE_WINDOW_SIZE - 1) recent events for the device
        from the data lake and appends the current event as the last row.
        data_processor.prepare_for_ml will then compute rolling features over
        this sequence, matching how features were built during training.

        Args:
            event_data: The current raw telemetry event dict.

        Returns:
            DataFrame with the window (historical events + current), oldest first.
            Falls back to just the current event if the data lake is empty.
        """
        device_id = event_data.get('deviceId', '')
        current_df = _keep_ml_cols(pd.json_normalize(event_data))

        if not device_id:
            return current_df

        # Import here to avoid circular dependency at module load time
        from storage.data_lake import data_lake

        historical = data_lake.get_recent_events_for_device(
            device_id, limit=INFERENCE_WINDOW_SIZE - 1
        )

        if historical.empty:
            return current_df

        historical_filtered = _keep_ml_cols(historical)
        window = pd.concat([historical_filtered, current_df], ignore_index=True)
        return window

    def _score_last_row(self, processed_df: pd.DataFrame) -> tuple[bool, float]:
        """
        Extract features from the last row of a processed dataframe and score it.

        The last row corresponds to the current event after rolling features have
        been computed over the full window.
        """
        last_row = processed_df.iloc[-1]

        features_df = pd.DataFrame(columns=self.feature_names)
        for feat in self.feature_names:
            features_df.at[0, feat] = (
                last_row[feat] if feat in last_row.index else 0.0
            )
        features_df = features_df.astype(float)

        score = float(self.model.decision_function(features_df)[0])
        is_anomaly = bool(score < self.threshold)
        return is_anomaly, score

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict_anomaly(self, event_data: dict[str, Any]) -> tuple[bool, float]:
        """
        Predict whether a single event is anomalous.

        Internally builds a temporal window using historical events from the data
        lake, ensuring rolling features are computed with real context rather than
        degenerate single-point values.

        Args:
            event_data: Raw telemetry event dict with keys: deviceId, timestamp,
                        enrichedData (nested dict of sensor readings).

        Returns:
            (is_anomaly, anomaly_score): score > 0 means normal, score < threshold
            means anomaly. The threshold is set from the training score distribution.
        """
        try:
            if self.model is None or self.feature_names is None:
                self.load_model()
                if self.model is None or self.feature_names is None:
                    return False, 0.0

            window_df = self._build_inference_window(event_data)
            df_processed = data_processor.prepare_for_ml(window_df)

            if df_processed.empty:
                logger.debug("Empty processed dataframe, skipping prediction.")
                return False, 0.0

            is_anomaly, score = self._score_last_row(df_processed)
            return is_anomaly, score

        except Exception as e:
            logger.error(f"Error during anomaly prediction: {e}", exc_info=True)
            return False, 0.0

    def predict_window(
        self, events: list[dict[str, Any]]
    ) -> list[tuple[bool, float]]:
        """
        Predict anomaly for each event in an explicit time-ordered sequence.

        Each event is scored using all preceding events in the list as rolling
        context. For the first event, historical context is fetched from the
        data lake (same as predict_anomaly).

        This is the recommended path for the /predict/batch API endpoint when
        the caller already has a sequence of recent readings for a device.

        Args:
            events: Chronologically ordered list of raw event dicts (oldest first).

        Returns:
            List of (is_anomaly, score) tuples, one per input event.
        """
        if not events:
            return []

        if self.model is None or self.feature_names is None:
            self.load_model()
            if self.model is None or self.feature_names is None:
                return [(False, 0.0)] * len(events)

        device_id = events[0].get('deviceId', '')
        results: list[tuple[bool, float]] = []

        # Normalize all events up front
        normalized = [_keep_ml_cols(pd.json_normalize(e)) for e in events]

        # For the first event, fetch historical context from the data lake
        from storage.data_lake import data_lake
        data_lake_history: pd.DataFrame = pd.DataFrame()
        if device_id:
            raw_history = data_lake.get_recent_events_for_device(
                device_id, limit=INFERENCE_WINDOW_SIZE - 1
            )
            if not raw_history.empty:
                data_lake_history = _keep_ml_cols(raw_history)

        for i, current_norm in enumerate(normalized):
            batch_preceding = normalized[max(0, i - (INFERENCE_WINDOW_SIZE - 1)):i]
            batch_context_size = len(batch_preceding)
            needed_from_lake = (INFERENCE_WINDOW_SIZE - 1) - batch_context_size

            if needed_from_lake > 0 and not data_lake_history.empty:
                # Fill the gap to reach a full window by taking the most recent
                # 'needed_from_lake' events from the data lake, then the batch
                # context accumulated so far, then the current event.
                lake_slice = data_lake_history.tail(needed_from_lake)
                parts = ([lake_slice]
                         + (batch_preceding if batch_preceding else [])
                         + [current_norm])
            elif batch_preceding:
                parts = [*batch_preceding, current_norm]
            else:
                parts = [current_norm]

            window = pd.concat(parts, ignore_index=True)

            df_processed = data_processor.prepare_for_ml(window)
            if df_processed.empty:
                results.append((False, 0.0))
                continue

            results.append(self._score_last_row(df_processed))

        return results


predictor = AnomalyPredictor()
