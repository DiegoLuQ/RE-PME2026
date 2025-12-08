FROM nginx:alpine

# Directorio de Nginx
WORKDIR /usr/share/nginx/html

# Borramos archivos por defecto
RUN rm -rf ./*

# Copiamos tus archivos
COPY index.html .
COPY script.js .

# Copiamos tu configuración de Nginx
COPY nginx.conf /etc/nginx/nginx.conf