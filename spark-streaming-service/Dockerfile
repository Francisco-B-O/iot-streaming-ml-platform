FROM python:3.11-slim

# Java is required by PySpark
RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy only application source — avoids including test files or secrets
COPY main.py .
COPY streaming/ ./streaming/
COPY config/ ./config/

ENV PYTHONPATH=/app
ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

# Run as non-root user
RUN useradd --no-create-home --shell /bin/false appuser && \
    chown -R appuser /app
USER appuser

CMD ["python", "main.py"]
