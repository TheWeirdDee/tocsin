# TOCSIN API (Railway). The frontend is deployed separately on Vercel.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
    PORT=8000
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY tocsin/ tocsin/
COPY server/ server/
COPY config/ config/
COPY results/ results/
COPY scripts/fetch_artifacts.py scripts/fetch_artifacts.py
# Download the pinned demo bundle once, at build time, and verify every checksum.
# The build fails (and nothing is deployed) if retrieval or verification fails.
RUN python scripts/fetch_artifacts.py
RUN useradd --create-home --uid 1000 app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8000'), timeout=4)" || exit 1
# Forwarded headers are not trusted by uvicorn; server/app.py derives the client from the proxy-appended entry.
CMD ["sh", "-c", "exec uvicorn server.app:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-proxy-headers"]
