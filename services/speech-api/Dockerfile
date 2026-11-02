FROM python:3.11-slim
WORKDIR /app
RUN useradd -u 10001 -m sauti
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sauti_ml ./sauti_ml
USER sauti
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "sauti_ml.api:app", "--host", "0.0.0.0", "--port", "8000"]
