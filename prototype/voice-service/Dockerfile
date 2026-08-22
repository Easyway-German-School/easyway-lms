FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /models \
  && python -m piper.download_voices de_DE-thorsten-medium \
  --data-dir /models

COPY app.py .
ENV PIPER_MODEL=/models/de_DE-thorsten-medium.onnx
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
