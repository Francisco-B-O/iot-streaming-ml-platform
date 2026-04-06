"""
Data Lake storage module for the IoT ML Platform.
Handles persistence and retrieval of telemetry events using Parquet files partitioned by day.
"""

import os
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List

import pandas as pd

from config.settings import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DataLake:
    """
    Manages storage and retrieval of telemetry data in a local file-based data lake.
    """
    def __init__(self, base_path: Optional[str] = None):
        """
        Initializes the DataLake and ensures the base storage path exists.
        
        Args:
            base_path (Optional[str]): Root directory for the data lake storage.
        """
        self.base_path = base_path or settings.DATA_LAKE_PATH
        try:
            if not os.path.exists(self.base_path):
                os.makedirs(self.base_path, exist_ok=True)
                logger.info(f"Created data lake base directory at {self.base_path}")
        except Exception as e:
            logger.error(f"Failed to create data lake base directory: {e}")
            raise

    def store_event(self, event_data: Dict[str, Any]) -> Optional[str]:
        """
        Stores a single event in the data lake as a Parquet file.
        Enforces inclusion of ML fields and partitioning by date.
        
        Args:
            event_data (Dict[str, Any]): The telemetry event data to store.
            
        Returns:
            Optional[str]: Path to the saved Parquet file, or None if storage failed.
        """
        try:
            df = pd.json_normalize(event_data)
            
            # Manually ensure ML fields are present if they exist in the dict
            for field in ['anomaly_score', 'is_anomaly']:
                if field in event_data and field not in df.columns:
                    df[field] = event_data[field]
                    
            # Add arrival timestamp
            if 'arrival_timestamp' not in df.columns:
                df['arrival_timestamp'] = datetime.now().isoformat()
                
            # Partition by day for simple data lake structure
            today = datetime.now().strftime("%Y-%m-%d")
            daily_path = os.path.join(self.base_path, f"day={today}")
            
            if not os.path.exists(daily_path):
                os.makedirs(daily_path, exist_ok=True)
                
            timestamp_str = datetime.now().strftime("%H%M%S_%f")
            file_path = os.path.join(daily_path, f"event_{timestamp_str}.parquet")
            
            df.to_parquet(file_path, index=False)
            logger.debug(f"Event stored at {file_path}")
            return file_path
        except Exception as e:
            logger.error(f"Error storing event in data lake: {e}", exc_info=True)
            return None

    def get_latest_data(self, limit: int = 1000) -> pd.DataFrame:
        """
        Retrieves the latest data from the data lake across all partitions.
        
        Args:
            limit (int): Approximate number of records to retrieve.
            
        Returns:
            pd.DataFrame: A dataframe containing the concatenated records.
        """
        try:
            all_files = []
            for root, _, files in os.walk(self.base_path):
                for file in files:
                    if file.endswith(".parquet"):
                        all_files.append(os.path.join(root, file))
            
            if not all_files:
                logger.warning("No Parquet files found in data lake.")
                return pd.DataFrame()
                
            # Sort files by modification time descending to get newest data first
            all_files.sort(key=os.path.getmtime, reverse=True)
            
            # Load newest files until we reach the approximate record limit
            dfs: List[pd.DataFrame] = []
            total_count = 0
            for f in all_files:
                try:
                    current_df = pd.read_parquet(f)
                    dfs.append(current_df)
                    total_count += len(current_df)
                    if total_count >= limit:
                        break
                except Exception as file_error:
                    logger.error(f"Error reading Parquet file {f}: {file_error}")
                    continue
                    
            if not dfs:
                return pd.DataFrame()
                
            combined_df = pd.concat(dfs, ignore_index=True)
            logger.info(f"Retrieved {len(combined_df)} records from data lake.")
            return combined_df
        except Exception as e:
            logger.error(f"Error retrieving data from lake: {e}", exc_info=True)
            return pd.DataFrame()

    def get_recent_events_for_device(self, device_id: str, limit: int = 5) -> pd.DataFrame:
        """
        Retrieves the most recent N events for a specific device from the data lake.

        Used to build temporal context for rolling-window feature computation during
        inference. Each stored event has enrichedData.* columns (from json_normalize
        at store time), which are directly compatible with data_processor.prepare_for_ml.

        Args:
            device_id (str): The device identifier to filter events by.
            limit (int): Maximum number of recent events to return.

        Returns:
            pd.DataFrame: Events for the device, sorted oldest-first (for rolling order),
                          or empty DataFrame if none found.
        """
        try:
            all_files = []
            for root, _, files in os.walk(self.base_path):
                for file in files:
                    if file.endswith(".parquet"):
                        all_files.append(os.path.join(root, file))

            if not all_files:
                return pd.DataFrame()

            # Newest files first — stop as soon as we have enough events for this device
            all_files.sort(key=os.path.getmtime, reverse=True)

            device_events: List[pd.DataFrame] = []
            found = 0
            for f in all_files[:300]:  # cap scan to avoid reading entire lake on every call
                try:
                    df = pd.read_parquet(f)
                    if 'deviceId' not in df.columns:
                        continue
                    rows = df[df['deviceId'] == device_id]
                    if not rows.empty:
                        device_events.append(rows)
                        found += len(rows)
                        if found >= limit:
                            break
                except Exception:
                    continue

            if not device_events:
                return pd.DataFrame()

            combined = pd.concat(device_events, ignore_index=True)
            # Return oldest-first so rolling windows are in chronological order
            if 'timestamp' in combined.columns:
                combined = combined.sort_values('timestamp', ascending=True)
            return combined.head(limit)
        except Exception as e:
            logger.error(f"Error retrieving recent events for device {device_id}: {e}", exc_info=True)
            return pd.DataFrame()


data_lake = DataLake()
