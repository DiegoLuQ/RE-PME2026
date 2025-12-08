import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse 
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
import uuid
import pandas as pd
from io import BytesIO

# ==========================================
# 1. CONFIGURACIÓN Y BASE DE DATOS
# ==========================================

# Cargar variables desde archivo .env (solo para desarrollo local)
load_dotenv()

# Obtener variables de entorno (Con valores por defecto si fallan)
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "pme_colegios")

print(f"🔌 Conectando a MongoDB en: {MONGO_URI} (DB: {DB_NAME})")

try:
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    # Verificar conexión
    client.admin.command('ping')
    print("✅ Conexión exitosa a MongoDB")
except Exception as e:
    print(f"❌ Error conectando a MongoDB: {e}")

# Colecciones
col_colegios = db["colegios"]
col_pme = db["pme"]
col_acciones = db["acciones"]
col_recursos = db["recursos"]
col_users = db["users"]

app = FastAPI(title="API Orquestador PME")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 2. UTILIDADES Y ESQUEMAS
# ==========================================

class PyObjectId(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(str(v)):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update(type="string")

# Esquemas
class SchemaUser(BaseModel):
    perfil: str 
    contrasena: str

class ExportColumnas(BaseModel):
    columnas: List[str]

class SchemaClonacion(BaseModel):
    id_pme_origen: str
    id_pme_destino: str

class SchemaColegio(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    nombre: str
    rbd: str
    rut: str
    direccion: Optional[str] = None
    telefono: Optional[str] = None
    director: Optional[str] = None
    # CAMBIO AQUÍ: Ahora es string (URL)
    imagen: Optional[str] = None 
    
    
    class Config:
        allow_population_by_field_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

class Schema_PME(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)
    year: int
    id_colegio: str
    director: str
    observacion: str
    class Config:
        allow_population_by_field_name = True
        json_encoders = {ObjectId: str}

class Schema_PME_Update(BaseModel):
    director: str
    observacion: str

class Schema_PME_Create(BaseModel):
    year: int
    id_colegio: str
    director: str
    observacion: str
    clonar: bool = False

class Schema_Acciones(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    uuid_accion: str = Field(default_factory=lambda: str(uuid.uuid4()))
    id_pme: str
    year: int
    nombre_accion: str
    descripcion: str
    dimension: str
    subdimensiones: List[str] = []
    objetivo_estrategico: Optional[str] = None
    estrategia: Optional[str] = None
    planes: Optional[str] = None
    responsable: Optional[str] = None
    recursos_necesarios_ejecucion: Optional[str] = None
    medios_verificacion: Optional[str] = None
    monto_sep: int = 0
    monto_total: int = 0
    fecha_actualizacion: datetime = Field(default_factory=datetime.now)
    class Config:
        allow_population_by_field_name = True
        json_encoders = {ObjectId: str}

class Schema_Recursos(BaseModel):
    id: Optional[PyObjectId] = Field(alias='_id', default=None)
    id_pme: str
    uuid_accion: str
    dimension: Optional[str] = None
    subdimension: Optional[str] = None
    nombre_actividad: Optional[str] = None
    descripcion_actividad: Optional[str] = None
    medios_ver: Optional[str] = None
    responsable: Optional[str] = None
    recursos_actividad: List[str] = []
    monto: int = 0
    year: int
    fecha: datetime = Field(default_factory=datetime.now)
    class Config:
        allow_population_by_field_name = True
        json_encoders = {ObjectId: str}

# ==========================================
# 3. ENDPOINTS: AUTH
# ==========================================

@app.post("/api/login")
def login(user: SchemaUser):
    usuario_encontrado = col_users.find_one({
        "perfil": user.perfil, 
        "contrasena": user.contrasena
    })
    if usuario_encontrado:
        return {
            "msg": "Login exitoso", 
            "perfil": usuario_encontrado["perfil"],
            "token": "token_simple_123"
        }
    raise HTTPException(status_code=401, detail="Credenciales incorrectas")

# ==========================================
# 4. ENDPOINTS: COLEGIOS
# ==========================================

@app.get("/api/colegios")
def get_colegios():
    colegios = list(col_colegios.find())
    for c in colegios: c["_id"] = str(c["_id"])
    return colegios

@app.post("/api/colegios")
def create_colegio(col: SchemaColegio):
    if col_colegios.find_one({"nombre": col.nombre}):
        raise HTTPException(status_code=400, detail="Nombre de colegio ya existe")
    new_col = col.dict(by_alias=True, exclude={"id"})
    new_col["_id"] = str(ObjectId()) 
    col_colegios.insert_one(new_col)
    return {"msg": "Colegio creado", "id": new_col["_id"]}

# ==========================================
# 5. ENDPOINTS: PME (COMPLETO)
# ==========================================

@app.get("/api/pme/buscar")
def get_pme_id(id_colegio: str, year: int):
    pme = col_pme.find_one({"id_colegio": id_colegio, "year": year})
    if pme:
        return {"id_pme": str(pme["_id"]), "exist": True}
    return {"exist": False, "msg": "No se encontró PME"}

@app.post("/api/pme")
def create_pme(pme: Schema_PME_Create):
    # Validar existencia
    if col_pme.find_one({"id_colegio": pme.id_colegio, "year": pme.year}):
        raise HTTPException(status_code=400, detail="El PME ya existe")
    
    # Crear PME
    new_pme = pme.dict(exclude={"clonar"})
    new_pme["_id"] = str(ObjectId())
    col_pme.insert_one(new_pme)
    
    acciones_copiadas = 0
    
    # Clonación
    if pme.clonar:
        year_ant = pme.year - 1
        pme_ant = col_pme.find_one({"id_colegio": pme.id_colegio, "year": year_ant})
        
        if pme_ant:
            id_old = str(pme_ant["_id"])
            id_new = new_pme["_id"]
            
            # Copiar Acciones
            acciones = list(col_acciones.find({"id_pme": id_old}))
            for acc in acciones:
                uuid_old = acc["uuid_accion"]
                uuid_new = str(uuid.uuid4())
                
                acc_new = acc.copy()
                del acc_new["_id"]
                acc_new.update({"id_pme": id_new, "year": pme.year, "uuid_accion": uuid_new})
                col_acciones.insert_one(acc_new)
                acciones_copiadas += 1
                
                # Copiar Recursos
                recursos = list(col_recursos.find({"uuid_accion": uuid_old}))
                for rec in recursos:
                    rec_new = rec.copy()
                    del rec_new["_id"]
                    rec_new.update({"id_pme": id_new, "year": pme.year, "uuid_accion": uuid_new})
                    col_recursos.insert_one(rec_new)

    return {"msg": "Creado", "id_pme": new_pme["_id"], "copiados": acciones_copiadas}

# --- ENDPOINTS FALTANTES PARA GESTIÓN DE PME ---

@app.put("/api/pme/{id_pme}")
def actualizar_pme(id_pme: str, datos: Schema_PME_Update):
    try:
        col_pme.update_one(
            {"_id": id_pme}, 
            {"$set": {"director": datos.director, "observacion": datos.observacion}}
        )
        return {"msg": "PME Actualizado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. ELIMINAR UN PME (Y TODO SU CONTENIDO EN CASCADA)
@app.delete("/api/pme/{id_pme}")
def eliminar_pme_cascada(id_pme: str):
    try:
        # Borrar el PME
        res = col_pme.delete_one({"_id": id_pme}) # Recuerda que guardamos ID como string manual
        if res.deleted_count == 0:
             # Si no lo encuentra como string, intenta como ObjectId (por compatibilidad)
             col_pme.delete_one({"_id": id_pme})

        # Borrar Acciones asociadas (id_pme se guarda como string)
        col_acciones.delete_many({"id_pme": id_pme})
        
        # Borrar Recursos asociados
        col_recursos.delete_many({"id_pme": id_pme})
        
        return {"msg": "PME y todos sus datos eliminados correctamente"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 6. ENDPOINTS: ACCIONES
# ==========================================

@app.get("/api/acciones/{id_pme}")
def listar_acciones(id_pme: str):
    acciones = list(col_acciones.find({"id_pme": id_pme}))
    for acc in acciones: acc["_id"] = str(acc["_id"])
    return acciones 

@app.post("/api/acciones")
def crear_accion(accion: Schema_Acciones):
    new_acc = accion.dict(by_alias=True, exclude={"id"})
    col_acciones.insert_one(new_acc)
    return {"msg": "Acción creada", "uuid": new_acc["uuid_accion"]}

@app.put("/api/acciones/{uuid}")
def modificar_accion(uuid: str, accion: Schema_Acciones):
    update_data = accion.dict(exclude_unset=True, exclude={"id", "uuid_accion"})
    update_data["fecha_actualizacion"] = datetime.now()
    res = col_acciones.update_one({"uuid_accion": uuid}, {"$set": update_data})
    if res.modified_count == 0:
        return {"msg": "No se modificó nada"}
    return {"msg": "Acción actualizada"}

@app.delete("/api/acciones/{uuid}")
def eliminar_accion(uuid: str):
    col_acciones.delete_one({"uuid_accion": uuid})
    col_recursos.delete_many({"uuid_accion": uuid})
    return {"msg": "Acción eliminada"}

@app.post("/api/acciones/importar_excel")
async def importar_acciones_excel(id_pme: str, year: int, file: UploadFile = File(...)):
    try:
        if not file.filename.endswith(('.xls', '.xlsx')):
             raise HTTPException(status_code=400, detail="Formato inválido. Use .xlsx")

        contents = await file.read()
        df = pd.read_excel(BytesIO(contents))
        df.columns = [c.strip().lower().replace(' ', '_').replace('ó','o').replace('é','e').replace('í','i').replace('á','a') for c in df.columns]
        df = df.fillna("")
        data = df.to_dict('records')
        
        insert_list = []
        for row in data:
            row["uuid_accion"] = str(uuid.uuid4())
            row["id_pme"] = id_pme
            row["year"] = year
            sub = row.get("subdimensiones", "")
            row["subdimensiones"] = [s.strip() for s in sub.split(',')] if sub else []

            try:
                acc = Schema_Acciones(**row)
                acc_dict = acc.dict(by_alias=True, exclude={"id"})
                acc_dict["_id"] = str(ObjectId())
                insert_list.append(acc_dict)
            except Exception: continue

        if insert_list:
            res = col_acciones.insert_many(insert_list)
            return {"msg": "Importación exitosa", "total": len(res.inserted_ids)}
        return {"msg": "No se importaron datos", "total": 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Error interno")

@app.get("/api/acciones/exportar/{id_pme}")
def exportar_acciones_excel(id_pme: str):
    try:
        acciones = list(col_acciones.find({"id_pme": id_pme}))
        if not acciones: raise HTTPException(status_code=404, detail="No hay acciones")

        df = pd.DataFrame(acciones)
        if "_id" in df.columns: del df["_id"]
        if "subdimensiones" in df.columns:
            df["subdimensiones"] = df["subdimensiones"].apply(lambda x: ", ".join(x) if isinstance(x, list) else str(x))

        stream = BytesIO()
        df.to_excel(stream, index=False, sheet_name="Acciones PME")
        stream.seek(0)
        filename = f"Acciones_PME_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"

        return StreamingResponse(
            stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 7. ENDPOINTS: RECURSOS
# ==========================================

@app.get("/api/recursos/{uuid_accion}")
def listar_recursos(uuid_accion: str):
    recursos = list(col_recursos.find({"uuid_accion": uuid_accion}))
    for r in recursos: r["_id"] = str(r["_id"])
    return recursos

@app.get("/api/recursos/pme/{id_pme}")
def listar_todos_recursos_pme(id_pme: str):
    recursos = list(col_recursos.find({"id_pme": id_pme}))
    for r in recursos: r["_id"] = str(r["_id"])
    return recursos

@app.post("/api/recursos")
def crear_recurso(recurso: Schema_Recursos):
    new_recurso = recurso.dict(by_alias=True, exclude={"id"})
    res = col_recursos.insert_one(new_recurso)
    return {"msg": "Recurso creado", "id": str(res.inserted_id)}

@app.put("/api/recursos/{id_recurso}")
def modificar_recurso(id_recurso: str, recurso: Schema_Recursos):
    update_data = recurso.dict(exclude_unset=True, exclude={"id"})
    try:
        col_recursos.update_one({"_id": id_recurso}, {"$set": update_data})
        return {"msg": "Recurso actualizado"}
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

@app.delete("/api/recursos/{id_recurso}")
def eliminar_recurso(id_recurso: str):
    try:
        col_recursos.delete_one({"_id": ObjectId(id_recurso)})
        return {"msg": "Recurso eliminado"}
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

@app.post("/api/recursos/importar_excel")
async def importar_recursos_excel(id_pme: str, year: int, file: UploadFile = File(...)):
    try:
        if not file.filename.endswith(('.xls', '.xlsx')): raise HTTPException(status_code=400, detail="Use .xlsx")
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents))
        df.columns = [c.strip().lower().replace(' ', '_').replace('ó','o').replace('descripción', 'descripcion') for c in df.columns]
        df = df.fillna("")
        data = df.to_dict('records')
        
        insert_list = []
        for row in data:
            row["id_pme"] = id_pme
            row["year"] = year
            uuid_traido = str(row.get("uuid_accion", "")).strip()
            row["uuid_accion"] = uuid_traido if uuid_traido and uuid_traido.lower() != "nan" else "sin asignar"
            rec_str = row.get("recursos_actividad", row.get("insumos", ""))
            row["recursos_actividad"] = [s.strip() for s in rec_str.split(',')] if rec_str else []

            try:
                res_obj = Schema_Recursos(**row)
                res_dict = res_obj.dict(by_alias=True, exclude={"id"})
                res_dict["_id"] = str(ObjectId())
                insert_list.append(res_dict)
            except Exception: continue

        if insert_list:
            res = col_recursos.insert_many(insert_list)
            return {"msg": "Importación exitosa", "total": len(res.inserted_ids), "huérfanos": sum(1 for x in insert_list if x["uuid_accion"] == "sin asignar")}
        return {"msg": "No se importaron datos", "total_registrados": 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/recursos/exportar_custom/{id_pme}")
def exportar_recursos_custom(id_pme: str, payload: ExportColumnas):
    try:
        recursos = list(col_recursos.find({"id_pme": id_pme}))
        if not recursos: raise HTTPException(status_code=404, detail="No hay recursos")

        acciones = list(col_acciones.find({"id_pme": id_pme}))
        acciones_map = {acc["uuid_accion"]: acc for acc in acciones}

        data_procesada = []
        for rec in recursos:
            accion_padre = acciones_map.get(rec.get("uuid_accion"), {})
            recursos_list = rec.get("recursos_actividad", [])
            recursos_str = ", ".join(recursos_list) if isinstance(recursos_list, list) else str(recursos_list)

            fila = {
                "nombre_actividad": rec.get("nombre_actividad", ""),
                "descripcion_actividad": rec.get("descripcion_actividad", ""),
                "responsable": rec.get("responsable", ""),
                "medios_ver": rec.get("medios_ver", ""),
                "recursos_actividad": recursos_str,
                "monto": rec.get("monto", 0),
                "year": rec.get("year", ""),
                "uuid_accion": rec.get("uuid_accion", ""),
                "nombre_accion": accion_padre.get("nombre_accion", "Huérfano"),
                "descripcion_accion": accion_padre.get("descripcion", ""),
                "dimension": accion_padre.get("dimension", "")
            }
            data_procesada.append(fila)

        df = pd.DataFrame(data_procesada)
        cols_finales = [c for c in payload.columnas if c in df.columns]
        if not cols_finales: cols_finales = df.columns.tolist()
        df = df[cols_finales]

        stream = BytesIO()
        df.to_excel(stream, index=False, sheet_name="Recursos PME")
        stream.seek(0)
        filename = f"Reporte_Actividades_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"

        return StreamingResponse(
            stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- EXPORTACIÓN ESPECÍFICA POR ACCIÓN ---

# 1. LISTAR TODOS LOS PMES DE UN COLEGIO
@app.get("/api/pmes/colegio/{id_colegio}")
def listar_pmes_por_colegio(id_colegio: str):
    try:
        # Buscamos todos los PME que coincidan con el ID del colegio
        lista_pmes = list(col_pme.find({"id_colegio": id_colegio}))
        
        # Convertimos ObjectId a string
        for pme in lista_pmes:
            pme["_id"] = str(pme["_id"])
            
        # Ordenamos por año descendente (del más nuevo al más viejo)
        lista_pmes.sort(key=lambda x: x["year"], reverse=True)
        
        return lista_pmes
    except Exception as e:
        print(f"Error listando PMEs: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    
@app.post("/api/recursos/exportar_custom_accion/{uuid_accion}")
def exportar_recursos_por_accion(uuid_accion: str, payload: ExportColumnas):
    try:
        # 1. Obtener Recursos de ESA acción
        recursos = list(col_recursos.find({"uuid_accion": uuid_accion}))
        if not recursos:
            raise HTTPException(status_code=404, detail="Esta acción no tiene recursos asociados")

        # 2. Obtener Datos de la Acción Padre
        accion = col_acciones.find_one({"uuid_accion": uuid_accion})
        if not accion:
            # Caso raro, pero por si acaso
            accion = {"nombre_accion": "Desconocida", "descripcion": "Sin descripción", "uuid_accion": uuid_accion}

        # 3. Aplanar datos (Flattening)
        data_procesada = []
        
        for rec in recursos:
            # Formatear lista de insumos
            recursos_list = rec.get("recursos_actividad", [])
            recursos_str = ", ".join(recursos_list) if isinstance(recursos_list, list) else str(recursos_list)

            fila = {
                # Datos Recurso
                "nombre_actividad": rec.get("nombre_actividad", ""),
                "descripcion_actividad": rec.get("descripcion_actividad", ""),
                "responsable": rec.get("responsable", ""),
                "medios_ver": rec.get("medios_ver", ""),
                "recursos_actividad": recursos_str,
                "monto": rec.get("monto", 0),
                "year": rec.get("year", ""),
                
                # Datos Acción (Fijos para todas las filas de este reporte)
                "uuid_accion": accion.get("uuid_accion", ""),
                "nombre_accion": accion.get("nombre_accion", ""),
                "descripcion_accion": accion.get("descripcion", "")
            }
            data_procesada.append(fila)

        # 4. Pandas
        df = pd.DataFrame(data_procesada)

        # 5. Filtrar columnas
        cols_finales = [c for c in payload.columnas if c in df.columns]
        if not cols_finales: cols_finales = df.columns.tolist()
        df = df[cols_finales]

        # 6. Renombrar
        nombres_bonitos = {
            "nombre_actividad": "Actividad",
            "descripcion_actividad": "Desc. Actividad",
            "recursos_actividad": "Insumos",
            "nombre_accion": "Acción",
            "descripcion_accion": "Desc. Acción",
            "uuid_accion": "UUID Acción"
        }
        df.rename(columns=nombres_bonitos, inplace=True)

        stream = BytesIO()
        df.to_excel(stream, index=False, sheet_name="Detalle Acción")
        stream.seek(0)

        filename = f"Detalle_Accion_{uuid_accion[:8]}.xlsx"

        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        print(f"Error exportando acción: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 8. INICIALIZACIÓN
# ==========================================

if not col_users.find_one({"perfil": "administrador"}):
    col_users.insert_one({"perfil": "administrador", "contrasena": "admin123"})
    print(">>> Usuario ADMIN creado")

if not col_users.find_one({"perfil": "usuario"}):
    col_users.insert_one({"perfil": "usuario", "contrasena": "user123"})
    print(">>> Usuario USUARIO creado")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)