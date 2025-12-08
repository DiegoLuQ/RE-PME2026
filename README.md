# 🏫 Orquestador PME - Sistema de Gestión Educativa

![Estado del Proyecto](https://img.shields.io/badge/Estado-En_Desarrollo-green)
![Docker](https://img.shields.io/badge/Docker-Enabled-blue)
![Python](https://img.shields.io/badge/Backend-FastAPI-yellow)

Plataforma web para la administración eficiente del Plan de Mejoramiento Educativo (PME). Permite gestionar acciones, recursos financieros y generar documentación oficial mediante un flujo de trabajo optimizado.

## 🚀 Características Principales

- **Gestión de Contexto:** Selección dinámica de Establecimiento y Año Fiscal.
- **Ciclo de Vida PME:** Creación de nuevos años con opción de **clonación automática** de acciones y recursos del año anterior.
- **CRUD Completo:** Gestión detallada de Acciones (Dimensiones, Estrategias) y Actividades (Recursos, Costos).
- **Carga Masiva:** Importación de planificaciones desde Excel (`.xlsx`).
- **Exportación:** Descarga de reportes personalizados y detalles de acciones en Excel.
- **Certificados:** Generación de certificados de ejecución en PDF con firma digitalizada y logo institucional.
- **Gestión de Inventario:** Vista global de recursos con detección de ítems "huérfanos" y reasignación visual.
- **Seguridad:** Control de acceso basado en roles (Administrador / Usuario).
- **Personalización UI:** Tablas con columnas configurables y persistencia de preferencias.

## 🛠️ Tecnologías Utilizadas

Este proyecto utiliza una arquitectura de microservicios orquestada con Docker:

*   **Frontend:** HTML5, JavaScript (ES6+), Tailwind CSS (Servido vía Nginx).
*   **Backend:** Python 3.10, FastAPI, Pydantic, Pandas.
*   **Base de Datos:** MongoDB Atlas (Nube).
*   **Infraestructura:** Docker & Docker Compose.
*   **Librerías Clave:** `html2pdf.js` (PDF), `pandas` (Excel), `pymongo` (DB Driver).

## 📋 Requisitos Previos

Asegúrate de tener instalado:
*   [Docker](https://www.docker.com/)
*   [Docker Compose](https://docs.docker.com/compose/)
*   Una cuenta y cluster en [MongoDB Atlas](https://www.mongodb.com/atlas) (o una instancia local).

## 🔧 Instalación y Despliegue

1.  **Clonar el repositorio:**
    ```bash
    git clone https://github.com/tu-usuario/orquestador-pme.git
    cd orquestador-pme
    ```

2.  **Configurar Variables de Entorno:**
    Crea un archivo `.env` en la raíz del proyecto basándote en el ejemplo:
    
    ```bash
    # Copiar ejemplo
    cp .env.example .env
    ```
    
    Edita el archivo `.env` con tus credenciales reales:
    ```env
    MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/?retryWrites=true&w=majority
    DB_NAME=pme_colegios
    PORT_FRONTEND=8090
    PORT_BACKEND=8001
    ```

3.  **Levantar Contenedores:**
    ```bash
    docker-compose up --build -d
    ```

4.  **Acceder a la Aplicación:**
    *   **Frontend (Web):** `http://localhost:8090`
    *   **Backend (Swagger UI):** `http://localhost:8001/docs`

## 📂 Estructura del Proyecto

```text
/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── backend.py       # API FastAPI
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── index.html       # Interfaz de Usuario
│   └── script.js        # Lógica del Cliente
├── docker-compose.yml   # Orquestación
├── .env                 # Credenciales (NO SUBIR A GIT)
└── .gitignore
