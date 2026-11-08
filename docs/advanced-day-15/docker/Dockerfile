FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

# Версия из requirements.txt присланного пайплайна.
RUN pip install --no-cache-dir "Flask==3.1.3"

WORKDIR /work
COPY stub_upstream.py attack_client.py wait_for_gateway.py /work/
