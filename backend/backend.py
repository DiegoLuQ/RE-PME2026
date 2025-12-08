import os
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse 
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict
from typing import List, Optional, Annotated
from datetime import datetime
from bson import ObjectId
import uuid
import pandas as pd
from io import BytesIO
from dotenv import load_dotenv
import certifi

# ==========================================
# 1. CONFIGURACIÓN Y BASE DE DATOS
# ==========================================

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "pme_colegios")

print(f"🔌 Conectando a: {MONGO_URI}")

try:
    # Agregamos tlsCAFile para evitar errores SSL en contenedores
    client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
    db = client[DB_NAME]
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
# 2. UTILIDADES Y ESQUEMAS (ADAPTADO PYDANTIC V2)
# ==========================================

# Lógica moderna para convertir ObjectId a String automáticamente
PyObjectId = Annotated[str, BeforeValidator(str)]

# --- Esquemas Generales ---
class SchemaUser(BaseModel):
    perfil: str 
    contrasena: str

class ExportColumnas(BaseModel):
    columnas: List[str]

class SchemaClonacion(BaseModel):
    id_pme_origen: str
    id_pme_destino: str

# --- Esquemas Colegio ---
class SchemaColegio(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    nombre: str
    rbd: str
    rut: str
    direccion: Optional[str] = None
    telefono: Optional[str] = None
    director: Optional[str] = None
    imagen: Optional[str] = None

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

# --- Esquemas PME ---
class Schema_PME(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    year: int
    id_colegio: str
    director: str
    observacion: str
    
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

class Schema_PME_Create(BaseModel):
    year: int
    id_colegio: str
    director: str
    observacion: str
    clonar: bool = False

# --- Esquemas Acciones ---
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

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

# --- Esquemas Recursos ---
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

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

# ==========================================
# 3. ENDPOINTS
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

# --- Colegios ---
@app.get("/api/colegios")
def get_colegios():
    colegios = list(col_colegios.find())
    for c in colegios: c["_id"] = str(c["_id"])
    return colegios

@app.post("/api/colegios")
def create_colegio(col: SchemaColegio):
    if col_colegios.find_one({"nombre": col.nombre}):
        raise HTTPException(status_code=400, detail="Nombre de colegio ya existe")
    
    # En V2 usamos model_dump en vez de dict()
    new_col = col.model_dump(by_alias=True, exclude={"id"}) 
    new_col["_id"] = str(ObjectId())
    
    col_colegios.insert_one(new_col)
    return {"msg": "Colegio creado", "id": new_col["_id"]}

# --- PME ---
@app.get("/api/pme/buscar")
def get_pme_id(id_colegio: str, year: int):
    pme = col_pme.find_one({"id_colegio": id_colegio, "year": year})
    if pme:
        return {"id_pme": str(pme["_id"]), "exist": True}
    return {"exist": False, "msg": "No se encontró PME"}

@app.get("/api/pmes/colegio/{id_colegio}")
def listar_pmes_por_colegio(id_colegio: str):
    data = list(col_pme.find({"id_colegio": id_colegio}))
    for p in data: p["_id"] = str(p["_id"])
    data.sort(key=lambda x: x["year"], reverse=True)
    return data

@app.post("/api/pme")
def create_pme(pme: Schema_PME_Create):
    if col_pme.find_one({"id_colegio": pme.id_colegio, "year": pme.year}):
        raise HTTPException(status_code=400, detail="El PME ya existe")
    
    new_pme = pme.model_dump(exclude={"clonar"})
    new_pme["_id"] = str(ObjectId())
    col_pme.insert_one(new_pme)
    
    acciones_copiadas = 0
    
    if pme.clonar:
        year_ant = pme.year - 1
        pme_ant = col_pme.find_one({"id_colegio": pme.id_colegio, "year": year_ant})
        
        if pme_ant:
            id_old = str(pme_ant["_id"])
            id_new = new_pme["_id"]
            
            acciones = list(col_acciones.find({"id_pme": id_old}))
            for acc in acciones:
                uuid_old = acc["uuid_accion"]
                uuid_new = str(uuid.uuid4())
                
                acc_new = acc.copy()
                del acc_new["_id"]
                acc_new.update({"id_pme": id_new, "year": pme.year, "uuid_accion": uuid_new})
                col_acciones.insert_one(acc_new)
                acciones_copiadas += 1
                
                recursos = list(col_recursos.find({"uuid_accion": uuid_old}))
                for rec in recursos:
                    rec_new = rec.copy()
                    del rec_new["_id"]
                    rec_new.update({"id_pme": id_new, "year": pme.year, "uuid_accion": uuid_new})
                    col_recursos.insert_one(rec_new)

    return {"msg": "Creado", "id_pme": new_pme["_id"], "copiados": acciones_copiadas}

@app.post("/api/pme/clonar")
def clonar_pme_anio_anterior(datos: SchemaClonacion):
    try:
        pme_destino = col_pme.find_one({"_id": datos.id_pme_destino})
        if not pme_destino:
             pme_destino = col_pme.find_one({"_id": ObjectId(datos.id_pme_destino)})
        
        if not pme_destino:
            raise HTTPException(status_code=404, detail="PME Destino no encontrado")
        
        nuevo_year = pme_destino["year"]
        acciones_origen = list(col_acciones.find({"id_pme": datos.id_pme_origen}))
        
        cnt_acc = 0
        for accion in acciones_origen:
            uuid_old = accion["uuid_accion"]
            uuid_new = str(uuid.uuid4())

            nueva = accion.copy()
            if "_id" in nueva: del nueva["_id"]
            nueva.update({"id_pme": datos.id_pme_destino, "year": nuevo_year, "uuid_accion": uuid_new})
            col_acciones.insert_one(nueva)
            cnt_acc += 1

            recursos = list(col_recursos.find({"uuid_accion": uuid_old}))
            for r in recursos:
                r_new = r.copy()
                if "_id" in r_new: del r_new["_id"]
                r_new.update({"id_pme": datos.id_pme_destino, "year": nuevo_year, "uuid_accion": uuid_new})
                col_recursos.insert_one(r_new)

        return {"msg": "Clonación manual exitosa", "acciones": cnt_acc}
    except Exception as e:
        print(f"Error clonar: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/pme/{id_pme}")
def eliminar_pme_cascada(id_pme: str):
    res = col_pme.delete_one({"_id": id_pme}) 
    if res.deleted_count == 0:
        try:
            col_pme.delete_one({"_id": ObjectId(id_pme)})
        except: pass
        
    col_acciones.delete_many({"id_pme": id_pme})
    col_recursos.delete_many({"id_pme": id_pme})
    return {"msg": "Eliminado"}

# --- Acciones ---
@app.get("/api/acciones/{id_pme}")
def listar_acciones(id_pme: str):
    data = list(col_acciones.find({"id_pme": id_pme}))
    for d in data: d["_id"] = str(d["_id"])
    return data

@app.post("/api/acciones")
def crear_accion(accion: Schema_Acciones):
    new_acc = accion.model_dump(by_alias=True, exclude={"id"})
    col_acciones.insert_one(new_acc)
    return {"msg": "Creada", "uuid": new_acc["uuid_accion"]}

@app.put("/api/acciones/{uuid}")
def modificar_accion(uuid: str, accion: Schema_Acciones):
    upd = accion.model_dump(exclude_unset=True, exclude={"id", "uuid_accion"})
    upd["fecha_actualizacion"] = datetime.now()
    
    res = col_acciones.update_one({"uuid_accion": uuid}, {"$set": upd})
    if res.modified_count == 0:
        return {"msg": "No se modificó nada o no existe"}
    return {"msg": "Acción actualizada"}

@app.delete("/api/acciones/{uuid}")
def eliminar_accion(uuid: str):
    col_acciones.delete_one({"uuid_accion": uuid})
    col_recursos.delete_many({"uuid_accion": uuid})
    return {"msg": "Eliminada"}

@app.post("/api/acciones/importar_excel")
async def importar_acciones_excel(id_pme: str, year: int, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents)).fillna("")
        df.columns = [c.strip().lower().replace(' ', '_').replace('ó','o').replace('é','e').replace('í','i').replace('á','a') for c in df.columns]
        
        insert_list = []
        for row in df.to_dict('records'):
            row["uuid_accion"] = str(uuid.uuid4())
            row["id_pme"] = id_pme
            row["year"] = year
            
            sub = row.get("subdimensiones", "")
            row["subdimensiones"] = [s.strip() for s in sub.split(',')] if sub else []

            try:
                acc = Schema_Acciones(**row)
                acc_dict = acc.model_dump(by_alias=True, exclude={"id"})
                acc_dict["_id"] = str(ObjectId())
                insert_list.append(acc_dict)
            except: continue

        if insert_list:
            res = col_acciones.insert_many(insert_list)
            return {"msg": "Importación exitosa", "total": len(res.inserted_ids)}
        return {"msg": "No se importaron datos", "total": 0}

    except Exception as e:
        print(f"Error importación: {e}")
        raise HTTPException(status_code=500, detail="Error interno")

@app.get("/api/acciones/exportar/{id_pme}")
def exportar_acciones_excel(id_pme: str):
    accs = list(col_acciones.find({"id_pme": id_pme}))
    if not accs: raise HTTPException(404, "No hay datos")
    
    df = pd.DataFrame(accs)
    if "_id" in df.columns: del df["_id"]
    
    if "subdimensiones" in df.columns:
        df["subdimensiones"] = df["subdimensiones"].apply(lambda x: ", ".join(x) if isinstance(x, list) else str(x))
        
    stream = BytesIO()
    df.to_excel(stream, index=False)
    stream.seek(0)
    fname = f"Acciones_PME_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={fname}"})

# --- Recursos ---
@app.get("/api/recursos/{uuid_accion}")
def listar_recursos(uuid_accion: str):
    data = list(col_recursos.find({"uuid_accion": uuid_accion}))
    for d in data: d["_id"] = str(d["_id"])
    return data

@app.get("/api/recursos/pme/{id_pme}")
def listar_todos_recursos_pme(id_pme: str):
    data = list(col_recursos.find({"id_pme": id_pme}))
    for d in data: d["_id"] = str(d["_id"])
    return data

@app.post("/api/recursos")
def crear_recurso(recurso: Schema_Recursos):
    new = recurso.model_dump(by_alias=True, exclude={"id"})
    res = col_recursos.insert_one(new)
    return {"msg": "Creado", "id": str(res.inserted_id), "uuid_accion_padre": new["uuid_accion"]}

@app.put("/api/recursos/{id_recurso}")
def modificar_recurso(id_recurso: str, recurso: Schema_Recursos):
    update_data = recurso.model_dump(exclude_unset=True, exclude={"id"})
    try:
        col_recursos.update_one({"_id": ObjectId(id_recurso)}, {"$set": update_data})
        return {"msg": "Recurso actualizado"}
    except: raise HTTPException(400, "ID inválido")

@app.delete("/api/recursos/{id_recurso}")
def eliminar_recurso(id_recurso: str):
    try:
        col_recursos.delete_one({"_id": ObjectId(id_recurso)})
        return {"msg": "Recurso eliminado"}
    except: raise HTTPException(400, "ID inválido")

@app.post("/api/recursos/importar_excel")
async def importar_recursos_excel(id_pme: str, year: int, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents)).fillna("")
        df.columns = [c.strip().lower().replace(' ', '_').replace('ó','o').replace('descripción','descripcion') for c in df.columns]
        
        insert_list = []
        for row in df.to_dict('records'):
            row.update({"id_pme": id_pme, "year": year})
            uuid_traido = str(row.get("uuid_accion", "")).strip()
            row["uuid_accion"] = uuid_traido if uuid_traido and uuid_traido.lower() != "nan" else "sin asignar"
            
            rs = row.get("recursos_actividad", row.get("insumos", ""))
            row["recursos_actividad"] = [s.strip() for s in rs.split(',')] if rs else []
            
            try:
                res_obj = Schema_Recursos(**row)
                res_dict = res_obj.model_dump(by_alias=True, exclude={"id"})
                res_dict["_id"] = str(ObjectId())
                insert_list.append(res_dict)
            except: continue

        if insert_list:
            res = col_recursos.insert_many(insert_list)
            return {"msg": "Importado", "total_registrados": len(res.inserted_ids), "huérfanos": sum(1 for x in insert_list if x["uuid_accion"] == "sin asignar")}
        return {"msg": "Sin datos", "total_registrados": 0}
    except Exception as e:
        print(f"Error importacion recursos: {e}")
        raise HTTPException(500, str(e))

@app.post("/api/recursos/exportar_custom/{id_pme}")
def exportar_recursos_custom(id_pme: str, payload: ExportColumnas):
    recursos = list(col_recursos.find({"id_pme": id_pme}))
    if not recursos: raise HTTPException(404, "No hay recursos")
    
    acciones = list(col_acciones.find({"id_pme": id_pme}))
    acciones_map = {a["uuid_accion"]: a for a in acciones}
    
    data_procesada = []
    for rec in recursos:
        padre = acciones_map.get(rec.get("uuid_accion"), {})
        r_list = rec.get("recursos_actividad", [])
        
        fila = {
            "nombre_actividad": rec.get("nombre_actividad", ""),
            "descripcion_actividad": rec.get("descripcion_actividad", ""),
            "responsable": rec.get("responsable", ""),
            "medios_ver": rec.get("medios_ver", ""),
            "recursos_actividad": ", ".join(r_list) if isinstance(r_list, list) else str(r_list),
            "monto": rec.get("monto", 0),
            "year": rec.get("year", ""),
            "uuid_accion": rec.get("uuid_accion", ""),
            "nombre_accion": padre.get("nombre_accion", "Huérfano"),
            "descripcion_accion": padre.get("descripcion", ""),
            "dimension": padre.get("dimension", "")
        }
        data_procesada.append(fila)
        
    df = pd.DataFrame(data_procesada)
    cols = [c for c in payload.columnas if c in df.columns] or df.columns.tolist()
    df = df[cols]
    
    stream = BytesIO()
    df.to_excel(stream, index=False)
    stream.seek(0)
    fname = f"Recursos_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={fname}"})

@app.post("/api/recursos/exportar_custom_accion/{uuid_accion}")
def exportar_recursos_accion_custom(uuid_accion: str, payload: ExportColumnas):
    recursos = list(col_recursos.find({"uuid_accion": uuid_accion}))
    if not recursos: raise HTTPException(404, "No hay recursos en esta acción")
    
    accion_padre = col_acciones.find_one({"uuid_accion": uuid_accion}) or {}
    
    data_procesada = []
    for rec in recursos:
        r_list = rec.get("recursos_actividad", [])
        fila = {
            "nombre_actividad": rec.get("nombre_actividad", ""),
            "descripcion_actividad": rec.get("descripcion_actividad", ""),
            "responsable": rec.get("responsable", ""),
            "medios_ver": rec.get("medios_ver", ""),
            "recursos_actividad": ", ".join(r_list) if isinstance(r_list, list) else str(r_list),
            "monto": rec.get("monto", 0),
            "year": rec.get("year", ""),
            "uuid_accion": uuid_accion,
            "nombre_accion": accion_padre.get("nombre_accion", ""),
            "descripcion_accion": accion_padre.get("descripcion", ""),
            "dimension": accion_padre.get("dimension", "")
        }
        data_procesada.append(fila)
        
    df = pd.DataFrame(data_procesada)
    cols = [c for c in payload.columnas if c in df.columns] or df.columns.tolist()
    df = df[cols]
    
    stream = BytesIO()
    df.to_excel(stream, index=False)
    stream.seek(0)
    
    nom_clean = str(accion_padre.get("nombre_accion", "Accion"))[:15].replace(" ", "_")
    fname = f"Detalle_{nom_clean}.xlsx"
    return StreamingResponse(stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={fname}"})

# --- Init Users ---
if not col_users.find_one({"perfil": "administrador"}):
    col_users.insert_one({"perfil": "administrador", "contrasena": "admin123"})
    print(">>> Usuario ADMIN creado")
if not col_users.find_one({"perfil": "usuario"}):
    col_users.insert_one({"perfil": "usuario", "contrasena": "user123"})
    print(">>> Usuario VISITA creado")

if __name__ == "__main__":
    import uvicorn
    # Se usa el puerto 8000 dentro del contenedor
    uvicorn.run(app, host="0.0.0.0", port=8000)