FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 BOT_STATE_DIR=/app/state
COPY telegram_bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 bot && mkdir /app/state && chown bot:bot /app/state
COPY --chown=bot:bot telegram_bot/app.py telegram_bot/healthcheck.py telegram_bot/supervisor.py ./
USER bot
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD python healthcheck.py
CMD ["python", "supervisor.py"]
