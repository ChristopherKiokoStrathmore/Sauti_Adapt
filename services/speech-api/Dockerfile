# Multi-platform python 3.11.18 slim index digest, recorded from Docker Hub on 2026-11-06.
FROM python:3.11-slim@sha256:db20d8506e2f15b6db39b40b6015ca46bae855dec6dd326d462cfe79ae972893
WORKDIR /app
RUN useradd -u 10001 -m sauti
ENV PIP_NO_CACHE_DIR=1 HF_HOME=/opt/hf-cache TOKENIZERS_PARALLELISM=false
COPY requirements.txt requirements-ml.txt ./
# CPU-only PyTorch. The default Linux wheel bundles CUDA and adds several GB.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements-ml.txt
# Bake the frozen encoder into the image so the first request does not download ~360 MB.
RUN python -c "from transformers import AutoFeatureExtractor, Wav2Vec2Model; m='facebook/wav2vec2-base'; AutoFeatureExtractor.from_pretrained(m); Wav2Vec2Model.from_pretrained(m)" \
 && chmod -R a+rX /opt/hf-cache
COPY sauti_ml ./sauti_ml
USER sauti
EXPOSE 8000
CMD ["uvicorn", "sauti_ml.api:app", "--host", "0.0.0.0", "--port", "8000"]
