# Usamos una imagen ligera de Python
FROM python:3.9-slim-buster

# Directorio de trabajo
WORKDIR /app

# Instalamos dependencias
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el código
COPY backend.py .

# Comando para iniciar (Exponemos el puerto 8000)
CMD ["uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "8002"]