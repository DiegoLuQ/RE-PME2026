const API = "http://localhost:8001/api";

// --- UTILIDADES (HELPERS) ---
const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;
const setVal = (id, v) => $(id).value = v;
const txt = (id, t) => {
    const el = $(id);
    if (el) {
        el.textContent = t;
    } else {
        console.warn(`⚠️ Advertencia: No se encontró el elemento HTML con id="${id}"`);
    }
};

// Wrapper genérico para peticiones API
async function apiCall(endpoint, method = 'GET', body = null, isFile = false) {
    const options = { method };
    if (body) {
        options.body = isFile ? body : JSON.stringify(body);
        if (!isFile) options.headers = { 'Content-Type': 'application/json' };
    }
    try {
        const res = await fetch(`${API}${endpoint}`, options);
        if (!res.ok) {
            // Intentar leer error como JSON, sino texto plano
            const errorText = await res.text();
            try { throw JSON.parse(errorText); } catch { throw { detail: errorText }; }
        }
        // Si es blob (archivo), retornarlo crudo
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/vnd.openxmlformats")) {
            return await res.blob();
        }
        return await res.json();
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}

// Control de Modales Genérico
function toggleModal(modalId, show = true) {
    const el = $(modalId);
    if (show) {
        el.classList.remove('hidden');
        el.classList.add('flex');
    } else {
        el.classList.add('hidden');
        el.classList.remove('flex');
    }
}

function truncarTexto(texto, largo = 50) {
    if (!texto) return '<span class="text-gray-300 italic">--</span>';
    if (texto.length <= largo) return texto;
    return `<span title="${texto.replace(/"/g, "&quot;")}" class="cursor-help border-b border-dotted border-gray-400 hover:text-blue-600 transition-colors">${texto.substring(0, largo)}...</span>`;
}

// --- ESTADO GLOBAL ---
const AppState = {
    // ... resto del estado ...
    config: {
        sidebarOpen: true,
        colsAcciones: { num: true, nombre: true, dimension: true, monto: true, opciones: true },
        colsRecursos: { nombre: true, recursos: true, desc_actividad: true, asociacion: true, desc_accion: true, monto: true, opciones: true },
        
        // NUEVA CONFIGURACIÓN CERTIFICADO (Tus 6 campos + extras)
        certFields: {
            colegio: true,
            anno: true,
            
            // Los 6 campos pedidos
            dimension: true,
            subdimension: true,
            nombre_accion: true,
            desc_accion: true,
            nombre_actividad: true,
            desc_actividad: true,

            // Extras
            recursos: true,
            monto: true,
            firma: true
        }
    }
};

// --- INICIALIZACIÓN ---
window.onload = async () => {
    cargarConfiguracionLocal();
    // No cargamos colegios hasta login
};

// ==============================================================
// 1. AUTENTICACIÓN Y CONFIGURACIÓN UI
// ==============================================================

async function realizarLogin(e) {
    e.preventDefault();
    const perfil = val("login-perfil").toLowerCase().trim();
    const pass = val("login-pass").trim();

    try {
        const data = await apiCall('/login', 'POST', { perfil, contrasena: pass });
        
        AppState.user = { perfil: data.perfil, token: data.token };
        txt("ctx-perfil", data.perfil);

        if (AppState.user.perfil === "administrador") {
            document.body.classList.add("is-admin");
        } else {
            document.body.classList.remove("is-admin");
        }

        toggleModal("modal-login", false);
        await cargarColegios();
    } catch (error) {
        txt("login-error", "Credenciales incorrectas o error de servidor.");
    }
}

// --- Sidebar y Configuración ---
function toggleSidebar() {
    AppState.config.sidebarOpen = !AppState.config.sidebarOpen;
    aplicarEstadoSidebar();
    guardarConfiguracionLocal();
}

function aplicarEstadoSidebar() {
    const sidebar = $("sidebar");
    const icon = $("toggle-icon");
    const texts = document.querySelectorAll(".sidebar-text");
    const iconsOnly = document.querySelectorAll(".sidebar-icon");

    if (AppState.config.sidebarOpen) {
        sidebar.classList.replace("w-20", "w-64");
        icon.setAttribute("d", "M15 19l-7-7 7-7"); 
        texts.forEach(el => el.classList.remove("hidden"));
        iconsOnly.forEach(el => el.classList.add("hidden"));
    } else {
        sidebar.classList.replace("w-64", "w-20");
        icon.setAttribute("d", "M9 5l7 7-7 7");
        texts.forEach(el => el.classList.add("hidden"));
        iconsOnly.forEach(el => el.classList.remove("hidden"));
        $("submenu-mantencion").classList.add("hidden");
    }
}

function toggleMantencion() {
    if (!AppState.config.sidebarOpen) toggleSidebar();
    const submenu = $("submenu-mantencion");
    submenu.classList.toggle("hidden");
    txt("arrow-mantencion", submenu.classList.contains("hidden") ? "▼" : "▲");
}

function cargarConfiguracionLocal() {
    const saved = localStorage.getItem("pme_config_ui");
    if (saved) AppState.config = { ...AppState.config, ...JSON.parse(saved) };
    aplicarEstadoSidebar();
}

function guardarConfiguracionLocal() {
    localStorage.setItem("pme_config_ui", JSON.stringify(AppState.config));
}

// ==============================================================
// 2. GESTIÓN DE CONTEXTO (DASHBOARD)
// ==============================================================

async function cargarColegios() {
    try {
        const data = await apiCall('/colegios');
        
        // GUARDAMOS LA LISTA COMPLETA EN MEMORIA
        AppState.listaColegios = data; 
        
        const select = $("sel-colegios");
        select.innerHTML = '<option value="">-- Selecciona --</option>';
        if (Array.isArray(data)) {
            data.forEach(col => {
                const opt = document.createElement("option");
                opt.value = col._id; 
                opt.textContent = col.nombre;
                select.appendChild(opt);
            });
        }
    } catch (e) { console.error(e); }
}

async function establecerContexto() {
    const idColegio = val("sel-colegios");
    const year = parseInt(val("sel-year"));

    const colegioCompleto = AppState.listaColegios.find(c => c._id === idColegio);

    $("pme-alert-box").classList.add("hidden-section");
    txt("dashboard-msg", "");

    if (!idColegio || !year) return alert("Selecciona colegio y año válido.");

    txt("dashboard-msg", "Verificando existencia...");
    
    try {
        const data = await apiCall(`/pme/buscar?id_colegio=${idColegio}&year=${year}`);
        
        if (data.exist) {
            // configurarSesion(idColegio, selText, year, data.id_pme);
            configurarSesion(colegioCompleto, year, data.id_pme);
        } else {
            txt("dashboard-msg", "");
            $("pme-alert-box").classList.remove("hidden-section");
        }
    } catch (e) {
        txt("dashboard-msg", "Error de conexión.");
        $("dashboard-msg").className = "text-red-500 mt-4 text-center text-sm font-medium";
    }
}

// Actualizamos los parámetros que recibe esta función
function configurarSesion(objColegio, year, idPme) {
    // AHORA AppState.colegio TIENE TODOS LOS DATOS (RUT, RBD, ETC)
    AppState.colegio = objColegio; 
    
    AppState.year = year;
    AppState.idPme = idPme;
    
    txt("ctx-colegio", objColegio.nombre);
    txt("ctx-year", year);
    navTo("acciones");
}

// --- PME Modal (Con Clonación) ---
// Abrir el modal y detectar si existe el año anterior
// --- FUNCIONES PME (Lógica de Clonación) ---

async function abrirModalPME() {
    const idColegio = val("sel-colegios");
    const nombreColegio = $("sel-colegios").options[$("sel-colegios").selectedIndex].text;
    const yearActual = parseInt(val("sel-year"));
    const yearAnterior = yearActual - 1;

    // 1. Resetear UI del Formulario
    setVal("pme-id-colegio", idColegio);
    setVal("pme-nombre-colegio", nombreColegio);
    setVal("pme-year", yearActual);
    setVal("pme-director", "");
    setVal("pme-observacion", "");
    
    // 2. Estado Visual por defecto (Sin historial)
    $("pme-msg-copia").classList.add("hidden");
    $("btns-pme-normal").classList.remove("hidden"); // Mostrar botón simple
    $("btns-pme-opciones").classList.add("hidden");  // Ocultar botones complejos

    toggleModal("modal-pme", true);

    // 3. Verificar en background si existe el año anterior
    try {
        // Hacemos la consulta al API
        const res = await apiCall(`/pme/buscar?id_colegio=${idColegio}&year=${yearAnterior}`);
        
        if (res.exist) {
            // ¡EXISTE EL AÑO ANTERIOR! Cambiamos la interfaz
            txt("pme-year-ant-text", yearAnterior);
            txt("btn-year-copy", yearAnterior);
            
            // Mostrar bloque azul y botones dobles
            $("pme-msg-copia").classList.remove("hidden");
            $("btns-pme-normal").classList.add("hidden");    
            $("btns-pme-opciones").classList.remove("hidden"); 
        }
    } catch (e) { 
        console.warn("No se pudo verificar historial (es normal si es el primer año)", e); 
    }
}

async function procesarPME(clonar) {
    const director = val("pme-director");
    const obs = val("pme-observacion");
    
    if(!director || !obs) return alert("Por favor complete Director y Observación");

    const payload = {
        id_colegio: val("pme-id-colegio"),
        year: parseInt(val("pme-year")),
        director: director,
        observacion: obs,
        clonar: clonar // TRUE (Botón Copiar) o FALSE (Botón Vacío)
    };

    const btn = event.currentTarget; // Botón que se presionó
    const txtOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "Procesando...";

    try {
        const data = await apiCall('/pme', 'POST', payload);
        
        toggleModal("modal-pme", false);
        
        let msg = "✅ PME Creado exitosamente.";
        if(clonar) {
            msg += `\n📥 Se clonaron ${data.copiados} acciones del año anterior.`;
        } else {
            msg += `\n📄 Se creó un PME vacío.`;
        }
        alert(msg);

        // Entrar al sistema automáticamente
        configurarSesion(payload.id_colegio, val("pme-nombre-colegio"), payload.year, data.id_pme);

    } catch (e) {
        alert("Error: " + (e.detail || e));
    } finally {
        btn.disabled = false;
        btn.innerHTML = txtOriginal;
    }
}

// ==============================================================
// 3. NAVEGACIÓN
// ==============================================================

function navTo(page) {
    // Validación: Para ir a 'acciones' o 'recursos' necesito un PME seleccionado.
    // Para ir a 'gestion-pme' solo necesito un Colegio seleccionado.
    if (page === 'gestion-pme' && !AppState.colegio) {
        alert("Primero selecciona un colegio en el Dashboard.");
        return navTo('dashboard');
    }
    
    if ((page === 'acciones' || page === 'gestion-recursos') && !AppState.idPme) {
        alert("Primero configura el contexto.");
        return navTo('dashboard');
    }

    // Ocultar/Mostrar secciones
    document.querySelectorAll("section").forEach(el => el.classList.add("hidden-section"));
    $(`view-${page}`).classList.remove("hidden-section");

    // Sidebar activo
    document.querySelectorAll("aside nav button").forEach(btn => btn.classList.remove("active-link"));
    if ($(`nav-${page}`)) $(`nav-${page}`).classList.add("active-link");

    // Cargar datos según página
    if (page === "acciones") cargarAcciones();
    if (page === "gestion-recursos") cargarTodosRecursos();
    if (page === "gestion-pme") cargarTablaPMEs(); // <--- NUEVO
}

// ==============================================================
// 8. MANTENEDOR DE PME (Tabla y CRUD)
// ==============================================================

async function cargarTablaPMEs() {
    const tbody = $("tabla-pmes");
    const loading = $("loading-pmes");
    
    tbody.innerHTML = "";
    loading.classList.remove("hidden-section");

    // VALIDACIÓN: Si no hay colegio seleccionado, no podemos buscar
    if (!AppState.colegio || !AppState.colegio._id) {
        loading.classList.add("hidden-section");
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-500">Error: No hay colegio seleccionado en el contexto.</td></tr>`;
        return;
    }

    try {
        // Llamamos al nuevo endpoint usando _id
        const data = await apiCall(`/pmes/colegio/${AppState.colegio._id}`);
        loading.classList.add("hidden-section");

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-400">No hay historial de PME para este colegio.</td></tr>`;
            return;
        }

        data.forEach(pme => {
            const tr = document.createElement("tr");
            tr.className = "border-b hover:bg-indigo-50 transition-colors";
            const nextYear = pme.year + 1;

            tr.innerHTML = `
                <td class="p-4 text-center font-bold text-lg text-indigo-700 bg-indigo-50 border-r border-indigo-100">${pme.year}</td>
                <td class="p-4 font-medium">${pme.director}</td>
                <td class="p-4 text-gray-500 italic text-xs">${truncarTexto(pme.observacion, 50)}</td>
                <td class="p-4 text-center">
                    <div class="flex justify-center gap-2">
                        <!-- Entrar (Trabajar en ese año) -->
                        <button onclick="entrarPME(${pme.year}, '${pme._id}')" class="p-2 rounded bg-green-100 text-green-700 hover:bg-green-200 transition" title="Trabajar en el PME ${pme.year}">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>
                        </button>

                        <!-- Editar (Solo Admin) -->
                        <button onclick='editarPME(${JSON.stringify(pme)})' class="admin-only p-2 rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition" title="Editar">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>

                        <!-- Eliminar (Solo Admin) -->
                        <button onclick="eliminarPME('${pme._id}', ${pme.year})" class="admin-only p-2 rounded bg-red-100 text-red-700 hover:bg-red-200 transition" title="Eliminar PME">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) { 
        console.error(e); 
        loading.classList.add("hidden-section");
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Error de conexión</td></tr>`;
    }
}

function prepararCrearPME() {
    // Abre el modal normal de creación
    setVal("sel-year", new Date().getFullYear()); // Sugiere año actual
    abrirModalPME(); 
}

function prepararClonarPME(yearOrigen) {
    // Setea el input oculto global con el año SIGUIENTE al seleccionado
    // Esto engaña a abrirModalPME para que piense que elegimos ese año en el dashboard
    setVal("sel-year", yearOrigen + 1);
    abrirModalPME();
}

async function eliminarPME(idPme, year) {
    if(confirm(`⚠️ PELIGRO: Estás borrando el PME ${year}.\n\nSe eliminarán:\n- El PME\n- TODAS sus Acciones\n- TODAS sus Actividades\n\nEsta acción no se puede deshacer. ¿Confirmar?`)) {
        try {
            await apiCall(`/pme/${idPme}`, "DELETE");
            alert("PME eliminado.");
            // Si borramos el que estábamos usando, resetear contexto
            if (AppState.idPme === idPme) {
                AppState.idPme = null;
                txt("ctx-year", "---");
            }
            cargarTablaPMEs();
        } catch(e) { alert("Error: " + e.detail); }
    }
}

// Editar PME (Solo director y observación)
// Nota: Usamos un truco simple, reusar el modal de creación pero cambiando el comportamiento del botón
// O para hacerlo simple: un prompt o modal pequeño. Usemos el modal existente adaptado.

// --- EDICIÓN PME (Truco: Reutilizar modal PME cambiando comportamiento) ---
let editandoPMEId = null;

function editarPME(pme) {
    editandoPMEId = pme._id;
    
    // Rellenar modal con datos existentes
    setVal("pme-id-colegio", pme.id_colegio);
    setVal("pme-nombre-colegio", AppState.colegio.nombre);
    setVal("pme-year", pme.year);
    setVal("pme-director", pme.director);
    setVal("pme-observacion", pme.observacion);

    // Ajustar UI del modal para "Modo Edición"
    $("pme-msg-copia").classList.add("hidden");
    $("btns-pme-opciones").classList.add("hidden");
    // Reemplazar botón normal con botón de actualización
    $("btns-pme-normal").classList.remove("hidden");
    $("btns-pme-normal").innerHTML = `
        <button type="button" onclick="guardarEdicionPME()" class="px-6 py-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white font-bold shadow">
            Actualizar Datos
        </button>
    `;

    toggleModal("modal-pme", true);
}


async function guardarEdicionPME() {
    const payload = {
        director: val("pme-director"),
        observacion: val("pme-observacion")
    };

    try {
        await apiCall(`/pme/${editandoPMEId}`, "PUT", payload);
        toggleModal("modal-pme", false);
        cargarTablaPMEs(); // Refrescar tabla
        
        // Restaurar modal a estado original (Importante para cuando le den a Crear después)
        setTimeout(() => {
            editandoPMEId = null;
            $("btns-pme-normal").innerHTML = `
                <button type="button" onclick="procesarPME(false)" class="px-6 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow">
                    Crear PME
                </button>
            `;
        }, 500);

    } catch(e) { alert("Error al actualizar: " + e.detail); }
}


function entrarPME(year, id) {
    // Cambiar contexto y viajar
    AppState.year = year;
    AppState.idPme = id;
    txt("ctx-year", year);
    navTo('acciones');
}


// ==============================================================
// 4. GESTIÓN DE ACCIONES
// ==============================================================

async function cargarAcciones() {
    $("loading-acciones").classList.remove("hidden-section");
    $("tabla-acciones").innerHTML = "";
    try {
        AppState.acciones = await apiCall(`/acciones/${AppState.idPme}`);
        renderizarTablaAcciones(AppState.acciones);
    } catch (e) {} finally { $("loading-acciones").classList.add("hidden-section"); }
}

function renderizarTablaAcciones(lista) {
    const tbody = $("tabla-acciones");
    const cfg = AppState.config.colsAcciones;
    
    // Header
    const headers = [
        cfg.num ? '<th class="p-4 text-center border-b w-16">#</th>' : null,
        cfg.nombre ? '<th class="p-4 border-b">Nombre Acción</th>' : null,
        cfg.dimension ? '<th class="p-4 border-b">Dimensión</th>' : null,
        cfg.monto ? '<th class="p-4 border-b w-32">Monto</th>' : null,
        '<th class="p-4 border-b text-center w-48">Gestión</th>'
    ].filter(Boolean).join('');
    
    tbody.parentElement.querySelector("thead tr").innerHTML = headers;
    tbody.innerHTML = "";

    if (lista.length === 0) {
        const cols = (headers.match(/<th/g) || []).length;
        tbody.innerHTML = `<tr><td colspan="${cols}" class="p-8 text-center text-gray-400">No hay acciones registradas.</td></tr>`;
        return;
    }

    lista.forEach((acc, index) => {
        const tr = document.createElement("tr");
        tr.className = "border-b hover:bg-blue-50 transition-colors";
        const monto = acc.monto_total ? acc.monto_total.toLocaleString("es-CL") : "0";

        let html = '';
        if (cfg.num) html += `<td class="p-4 text-center font-bold text-gray-400">${index + 1}</td>`;
        if (cfg.nombre) html += `<td class="p-4 font-semibold text-gray-800">${acc.nombre_accion}</td>`;
        if (cfg.dimension) html += `<td class="p-4 text-sm text-gray-600"><span class="bg-gray-100 px-2 py-1 rounded border text-xs uppercase font-bold">${acc.dimension}</span></td>`;
        if (cfg.monto) html += `<td class="p-4 text-sm font-mono text-gray-700">$${monto}</td>`;

        html += `
            <td class="p-4 text-center flex justify-center gap-2">
                <button onclick='verRecursos(${JSON.stringify(acc)})' class="bg-purple-100 text-purple-700 hover:bg-purple-200 px-3 py-1 rounded text-xs font-bold transition">Actividades</button>
                <button onclick='prepararEdicionAccion(${JSON.stringify(acc)})' class="admin-only bg-yellow-100 text-yellow-700 hover:bg-yellow-200 px-3 py-1 rounded text-xs font-bold transition">Editar</button>
                <button onclick="eliminarAccion('${acc.uuid_accion}')" class="admin-only bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded text-xs font-bold transition">Eliminar</button>
            </td>`;
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

function filtrarTabla() {
    const texto = val("filtro-nombre").toLowerCase();
    const dim = val("filtro-dimension");
    const filtrados = AppState.acciones.filter(acc => {
        return acc.nombre_accion.toLowerCase().includes(texto) && (dim === "" || acc.dimension === dim);
    });
    renderizarTablaAcciones(filtrados);
}

// --- CRUD Acciones ---
function abrirModalAccion() {
    $("form-accion").reset();
    setVal("in-uuid", "");
    txt("modal-accion-titulo", "Crear Nueva Acción");
    toggleModal("modal-accion", true);
}

function prepararEdicionAccion(acc) {
    abrirModalAccion();
    txt("modal-accion-titulo", "Editar Acción");
    setVal("in-uuid", acc.uuid_accion);
    setVal("in-nombre", acc.nombre_accion);
    setVal("in-dimension", acc.dimension);
    setVal("in-subdimensiones", acc.subdimensiones ? acc.subdimensiones.join(", ") : "");
    setVal("in-descripcion", acc.descripcion);
    setVal("in-objetivo", acc.objetivo_estrategico || "");
    setVal("in-estrategia", acc.estrategia || "");
    setVal("in-planes", acc.planes || "");
    setVal("in-responsable", acc.responsable || "");
    setVal("in-medios", acc.medios_verificacion || "");
    setVal("in-recursos-nec", acc.recursos_necesarios_ejecucion || "");
    setVal("in-monto-sep", acc.monto_sep || 0);
    setVal("in-monto-total", acc.monto_total || 0);
}

async function guardarAccion(e) {
    e.preventDefault();
    const uuid = val("in-uuid");
    const subRaw = val("in-subdimensiones");
    const subArray = subRaw ? subRaw.split(",").map(s => s.trim()).filter(s => s !== "") : [];

    const payload = {
        id_pme: AppState.idPme,
        year: AppState.year,
        nombre_accion: val("in-nombre"),
        dimension: val("in-dimension"),
        subdimensiones: subArray,
        descripcion: val("in-descripcion"),
        objetivo_estrategico: val("in-objetivo"),
        estrategia: val("in-estrategia"),
        planes: val("in-planes"),
        responsable: val("in-responsable"),
        medios_verificacion: val("in-medios"),
        recursos_necesarios_ejecucion: val("in-recursos-nec"),
        monto_sep: parseInt(val("in-monto-sep") || 0),
        monto_total: parseInt(val("in-monto-total") || 0),
    };

    if (uuid) payload.uuid_accion = uuid;
    const url = uuid ? `/acciones/${uuid}` : `/acciones`;
    const method = uuid ? "PUT" : "POST";

    try {
        await apiCall(url, method, payload);
        toggleModal("modal-accion", false);
        cargarAcciones();
    } catch (e) { alert("Error al guardar acción"); }
}

async function eliminarAccion(uuid) {
    if (confirm("¿Estás seguro? Se borrará la acción y sus actividades.")) {
        try {
            await apiCall(`/acciones/${uuid}`, "DELETE");
            cargarAcciones();
        } catch(e) { alert("Error eliminando"); }
    }
}

// --- Excel Acciones ---
async function descargarExcelAcciones() {
    if (!AppState.idPme) return alert("Contexto no definido");
    const btn = event.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = "⏳";

    try {
        const res = await fetch(`${API}/acciones/exportar/${AppState.idPme}`);
        if(!res.ok) throw await res.json();
        const blob = await res.blob();
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Acciones_${AppState.year}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch(e) { alert("Error descarga: " + (e.detail || e)); }
    finally { btn.disabled = false; btn.innerHTML = original; }
}

// ==============================================================
// 5. GESTIÓN DE RECURSOS (VISTA DETALLE)
// ==============================================================

function verRecursos(accion) {
    AppState.accionSeleccionada = accion;
    txt("rec-titulo-accion", accion.nombre_accion);
    txt("rec-uuid-accion", accion.uuid_accion);
    txt("rec-dim-accion", accion.dimension);
    navTo("recursos");
    cargarRecursos(accion.uuid_accion);
}

async function cargarRecursos(uuidAccion) {
    const tbody = $("tabla-recursos");
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">Cargando...</td></tr>`;
    try {
        const data = await apiCall(`/recursos/${uuidAccion}`);
        tbody.innerHTML = "";
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400">No hay actividades.</td></tr>`;
            return;
        }
        data.forEach((rec) => {
            const tr = document.createElement("tr");
            tr.className = "border-b hover:bg-gray-50";
            const monto = rec.monto ? rec.monto.toLocaleString("es-CL") : "0";
            
            let htmlRecursos = "-";
            if (rec.recursos_actividad && rec.recursos_actividad.length > 0) {
                htmlRecursos = `<div class="flex flex-wrap gap-1">${rec.recursos_actividad.map(r => `<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded border border-yellow-200">${r}</span>`).join("")}</div>`;
            }

            tr.innerHTML = `
                <td class="p-4 font-semibold text-gray-800">${rec.nombre_actividad}</td>
                <td class="p-4 text-sm text-gray-600 w-1/3">${htmlRecursos}</td>
                <td class="p-4 text-sm text-gray-600">${rec.responsable || "S/I"}</td>
                <td class="p-4 text-sm font-mono text-gray-700">$${monto}</td>
                <td class="p-4 text-center">
                    <div class="flex justify-center gap-2 items-center">
                        <button onclick="abrirModalInsumo('${rec._id}')" class="bg-cyan-100 text-cyan-700 hover:bg-cyan-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1" title="Agregar Insumo"><span>+</span> Insumo</button>
                        <button onclick="eliminarRecurso('${rec._id}')" class="admin-only bg-red-100 text-red-600 hover:bg-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition">Eliminar</button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error(e); }
}

function abrirModalRecurso() {
    $("form-recurso").reset();
    setVal("rec-id", "");
    toggleModal("modal-recurso", true);
}

// ==============================================================
// 6. GESTIÓN GLOBAL DE RECURSOS
// ==============================================================

async function cargarTodosRecursos() {
    const loading = $("loading-recursos-global");
    loading.classList.remove("hidden-section");
    $("tabla-recursos-global").innerHTML = "";

    try {
        if (AppState.acciones.length === 0) {
            AppState.acciones = await apiCall(`/acciones/${AppState.idPme}`);
        }
        AppState.recursosGlobales = await apiCall(`/recursos/pme/${AppState.idPme}`);
        renderizarTablaRecursosGlobal(AppState.recursosGlobales);
    } catch (e) { console.error(e); } 
    finally { loading.classList.add("hidden-section"); }
}

function renderizarTablaRecursosGlobal(lista) {
    const tbody = $("tabla-recursos-global");
    const cfg = AppState.config.colsRecursos;

    const headers = [
        cfg.nombre ? '<th class="p-4 border-b w-1/5">Actividad</th>' : null,
        cfg.recursos ? '<th class="p-4 border-b w-1/6">Recursos</th>' : null,
        cfg.desc_actividad ? '<th class="p-4 border-b w-1/6">Desc. Actividad</th>' : null,
        cfg.asociacion ? '<th class="p-4 border-b w-1/5">Acción Asociada</th>' : null,
        cfg.desc_accion ? '<th class="p-4 border-b w-1/6">Desc. Acción</th>' : null,
        cfg.monto ? '<th class="p-4 border-b w-24">Monto</th>' : null,
        '<th class="p-4 border-b text-center w-32">Opciones</th>'
    ].filter(Boolean).join('');

    tbody.parentElement.querySelector("thead tr").innerHTML = headers;
    tbody.innerHTML = "";

    if (lista.length === 0) {
        const colspan = (headers.match(/<th/g) || []).length;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="p-8 text-center text-gray-400">No se encontraron resultados.</td></tr>`;
        return;
    }

    lista.forEach((rec) => {
        const accionPadre = AppState.acciones.find(a => a.uuid_accion === rec.uuid_accion);
        const nombreAccion = accionPadre ? `<span class="font-medium text-blue-800">${accionPadre.nombre_accion}</span>` : `<span class="text-red-500 font-bold text-xs bg-red-100 px-2 py-1 rounded">Huérfano</span>`;
        const descAccionTexto = accionPadre ? accionPadre.descripcion : "";
        const monto = rec.monto ? rec.monto.toLocaleString("es-CL") : "0";

        let htmlRecursos = "-";
        if (rec.recursos_actividad && rec.recursos_actividad.length > 0) {
            htmlRecursos = `<div class="flex flex-wrap gap-1">${rec.recursos_actividad.map(r => `<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded border border-yellow-200">${r}</span>`).join("")}</div>`;
        }

        const tr = document.createElement("tr");
        tr.className = "border-b hover:bg-gray-50 align-top transition-colors";

        let html = '';
        if (cfg.nombre) html += `<td class="p-4 font-semibold text-gray-800">${rec.nombre_actividad}</td>`;
        if (cfg.recursos) html += `<td class="p-4">${htmlRecursos}</td>`;
        if (cfg.desc_actividad) html += `<td class="p-4 text-sm text-gray-600">${truncarTexto(rec.descripcion_actividad, 50)}</td>`;
        if (cfg.asociacion) html += `<td class="p-4 text-sm">${nombreAccion}</td>`;
        if (cfg.desc_accion) html += `<td class="p-4 text-sm text-gray-500 italic">${truncarTexto(descAccionTexto, 50)}</td>`;
        if (cfg.monto) html += `<td class="p-4 text-sm font-mono whitespace-nowrap">$${monto}</td>`;

        html += `
            <td class="p-4 text-center">
                <div class="flex justify-center gap-2">
                    <button onclick="generarCertificado('${rec._id}')" class="p-2 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 hover:scale-110 transition shadow-sm" title="Generar Certificado"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg></button>
                    <button onclick='abrirModalAsociar(${JSON.stringify(rec)})' class="admin-only p-2 rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 hover:scale-110 transition shadow-sm" title="Mover"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg></button>
                    <button onclick='editarRecursoGlobal(${JSON.stringify(rec)})' class="admin-only p-2 rounded-lg bg-yellow-100 text-yellow-600 hover:bg-yellow-200 hover:scale-110 transition shadow-sm" title="Editar"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                    <button onclick="eliminarRecursoGlobal('${rec._id}')" class="admin-only p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 hover:scale-110 transition shadow-sm" title="Eliminar"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>`;
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

// --- FUNCIÓN DE FILTRO CON SELECTOR ---
function filtrarTablaRecursosGlobal() {
    // 1. Obtener valores
    const terminoBusqueda = normalizarTexto(document.getElementById("filtro-recurso-global").value);
    const tipoFiltro = document.getElementById("tipo-filtro-global").value; // 'todos', 'actividad', etc.

    // 2. Filtrar
    const filtrados = AppState.recursosGlobales.filter(rec => {
        // Preparar datos
        const accionPadre = AppState.acciones.find(a => a.uuid_accion === rec.uuid_accion);
        
        // Textos normalizados de cada campo
        const txtActividad = normalizarTexto(rec.nombre_actividad);
        const txtRecursos = normalizarTexto((rec.recursos_actividad || []).join(" ")); 
        const txtDescAct = normalizarTexto(rec.descripcion_actividad);
        const txtAccion = accionPadre ? normalizarTexto(accionPadre.nombre_accion) : "";
        const txtDescAccion = accionPadre ? normalizarTexto(accionPadre.descripcion) : "";

        // 3. Lógica según el Select
        switch (tipoFiltro) {
            case 'actividad':
                return txtActividad.includes(terminoBusqueda);
            case 'recursos':
                return txtRecursos.includes(terminoBusqueda);
            case 'desc_actividad':
                return txtDescAct.includes(terminoBusqueda);
            case 'accion':
                return txtAccion.includes(terminoBusqueda);
            case 'desc_accion':
                return txtDescAccion.includes(terminoBusqueda);
            case 'todos':
            default:
                // Busca en cualquiera (OR)
                return txtActividad.includes(terminoBusqueda) || 
                       txtRecursos.includes(terminoBusqueda) || 
                       txtDescAct.includes(terminoBusqueda) || 
                       txtAccion.includes(terminoBusqueda) || 
                       txtDescAccion.includes(terminoBusqueda);
        }
    });

    // 3. Renderizar
    renderizarTablaRecursosGlobal(filtrados);
}


// ==============================================================
// 7. LÓGICA COMPARTIDA (Guardar, Eliminar, Asociar)
// ==============================================================

async function guardarRecurso(e) {
    e.preventDefault();
    if (!AppState.accionSeleccionada) return alert("Error contexto");

    const rawList = val("rec-lista");
    const listArray = rawList ? rawList.split(",").map(s => s.trim()).filter(s => s !== "") : [];

    const payload = {
        id_pme: AppState.idPme,
        year: AppState.year,
        uuid_accion: AppState.accionSeleccionada.uuid_accion,
        nombre_actividad: val("rec-nombre"),
        descripcion_actividad: val("rec-descripcion"),
        responsable: val("rec-responsable"),
        medios_ver: val("rec-medios"),
        recursos_actividad: listArray,
        monto: parseInt(val("rec-monto") || 0),
        dimension: AppState.accionSeleccionada.dimension,
        subdimension: "",
    };

    const idRec = val("rec-id");
    const url = idRec ? `/recursos/${idRec}` : `/recursos`;
    const method = idRec ? "PUT" : "POST";

    try {
        await apiCall(url, method, payload);
        toggleModal("modal-recurso", false);
        
        if (!$("view-gestion-recursos").classList.contains("hidden-section")) {
            cargarTodosRecursos();
        } else {
            cargarRecursos(AppState.accionSeleccionada.uuid_accion);
        }
    } catch (e) { alert("Error al guardar actividad"); }
}

async function eliminarRecurso(id) {
    if (confirm("¿Eliminar actividad?")) {
        await apiCall(`/recursos/${id}`, "DELETE");
        cargarRecursos(AppState.accionSeleccionada.uuid_accion);
    }
}

async function eliminarRecursoGlobal(id) {
    if (confirm("¿Eliminar actividad definitivamente?")) {
        await apiCall(`/recursos/${id}`, "DELETE");
        cargarTodosRecursos();
    }
}

function editarRecursoGlobal(recurso) {
    const accionPadre = AppState.acciones.find(a => a.uuid_accion === recurso.uuid_accion);
    AppState.accionSeleccionada = accionPadre ? accionPadre : { uuid_accion: recurso.uuid_accion, dimension: recurso.dimension };

    abrirModalRecurso();
    setVal("rec-id", recurso._id);
    setVal("rec-nombre", recurso.nombre_actividad);
    setVal("rec-descripcion", recurso.descripcion_actividad || "");
    setVal("rec-responsable", recurso.responsable || "");
    setVal("rec-medios", recurso.medios_ver || "");
    setVal("rec-lista", recurso.recursos_actividad ? recurso.recursos_actividad.join(", ") : "");
    setVal("rec-monto", recurso.monto || 0);
}

// --- Asociar ---
function abrirModalAsociar(recurso) {
    setVal("asoc-id-recurso", recurso._id);
    txt("asoc-nombre-recurso", recurso.nombre_actividad);
    
    const select = $("asoc-select-accion");
    select.innerHTML = "";
    AppState.acciones.forEach((acc) => {
        const option = document.createElement("option");
        option.value = acc.uuid_accion; option.textContent = acc.nombre_accion;
        if (acc.uuid_accion === recurso.uuid_accion) option.selected = true;
        select.appendChild(option);
    });
    toggleModal("modal-asociar", true);
}

async function guardarAsociacion(e) {
    e.preventDefault();
    const idRecurso = val("asoc-id-recurso");
    const uuidNueva = val("asoc-select-accion");
    const accionNueva = AppState.acciones.find(a => a.uuid_accion === uuidNueva);
    const recursoOriginal = AppState.recursosGlobales.find(r => r._id === idRecurso);

    if (!accionNueva || !recursoOriginal) return alert("Error de datos.");

    const payload = {
        ...recursoOriginal,
        id_pme: recursoOriginal.id_pme,
        year: recursoOriginal.year,
        recursos_actividad: recursoOriginal.recursos_actividad || [],
        uuid_accion: uuidNueva, 
        dimension: accionNueva.dimension
    };
    delete payload._id; 

    try {
        await apiCall(`/recursos/${idRecurso}`, "PUT", payload);
        toggleModal("modal-asociar", false);
        cargarTodosRecursos();
    } catch (e) { alert("Error al asociar"); }
}

// --- Insumo Rápido ---
function abrirModalInsumo(idActividad) {
    setVal("ins-id-actividad", idActividad);
    setVal("ins-nombre", "");
    toggleModal("modal-insumo", true);
}

async function guardarNuevoInsumo(e) {
    e.preventDefault();
    const idActividad = val("ins-id-actividad");
    const nuevoInsumo = val("ins-nombre").trim();
    if (!nuevoInsumo) return;

    try {
        const resList = await apiCall(`/recursos/${AppState.accionSeleccionada.uuid_accion}`);
        const recursoActual = resList.find(r => r._id === idActividad);
        if(!recursoActual) return alert("Error localizando actividad");

        const lista = recursoActual.recursos_actividad || [];
        lista.push(nuevoInsumo);

        const payload = { ...recursoActual, recursos_actividad: lista };
        delete payload._id;

        await apiCall(`/recursos/${idActividad}`, "PUT", payload);
        toggleModal("modal-insumo", false);
        cargarRecursos(AppState.accionSeleccionada.uuid_accion);
    } catch (e) { alert("Error guardando insumo"); }
}

// --- Excel ---
function abrirModalImportar() {
    setVal("archivo-excel", "");
    $("btn-subir-excel").disabled = false;
    $("btn-subir-excel").innerHTML = `<span>⬆️</span> Subir y Procesar`;
    toggleModal("modal-importar", true);
}

function abrirModalImportarRecursos() {
    setVal("archivo-excel-recursos", "");
    $("btn-subir-rec-excel").disabled = false;
    $("btn-subir-rec-excel").innerHTML = `<span>⬆️</span> Subir Recursos`;
    toggleModal("modal-importar-recursos", true);
}

async function subirExcelAcciones(e) {
    e.preventDefault();
    const file = $("archivo-excel").files[0];
    if (!file) return alert("Selecciona archivo");

    const btn = $("btn-subir-excel");
    btn.disabled = true; btn.innerHTML = `<span>⏳</span> Procesando...`;

    const formData = new FormData();
    formData.append("file", file);

    try {
        const url = `/acciones/importar_excel?id_pme=${AppState.idPme}&year=${AppState.year}`;
        const data = await apiCall(url, "POST", formData, true); 
        alert(`Éxito: ${data.total_registrados} registros.`);
        toggleModal("modal-importar", false);
        cargarAcciones();
    } catch (e) { alert("Error: " + (e.detail || e)); }
    finally { btn.disabled = false; }
}

async function subirExcelRecursos(e) {
    e.preventDefault();
    const file = $("archivo-excel-recursos").files[0];
    if (!file) return alert("Selecciona archivo");

    const btn = $("btn-subir-rec-excel");
    btn.disabled = true; btn.innerHTML = `<span>⏳</span> Procesando...`;

    const formData = new FormData();
    formData.append("file", file);

    try {
        const url = `/recursos/importar_excel?id_pme=${AppState.idPme}&year=${AppState.year}`;
        const data = await apiCall(url, "POST", formData, true); 
        alert(`Éxito: ${data.total_registrados} regs. | Huérfanos: ${data.huérfanos}`);
        toggleModal("modal-importar-recursos", false);
        cargarTodosRecursos();
    } catch (e) { alert("Error: " + (e.detail || e)); }
    finally { btn.disabled = false; }
}

// --- Configuración Columnas ---
let tipoTablaConfigurando = "";

function abrirConfigColumnas(tipo) {
    tipoTablaConfigurando = tipo;
    const container = $("lista-columnas");
    container.innerHTML = "";

    const defs = {
        acciones: [
            { key: "num", label: "Número (#)" }, { key: "nombre", label: "Nombre Acción" },
            { key: "dimension", label: "Dimensión" }, { key: "monto", label: "Monto Total" }
        ],
        recursos: [
            { key: "nombre", label: "Actividad" }, { key: "recursos", label: "Recursos / Insumos" },
            { key: "desc_actividad", label: "Desc. Actividad" }, { key: "asociacion", label: "Acción Asociada" },
            { key: "desc_accion", label: "Desc. Acción" }, { key: "monto", label: "Monto" }
        ],
        // NUEVO: Definición para el Certificado
        certificado: [
    { key: "colegio", label: "Encabezado: Colegio" },
    { key: "anno", label: "Encabezado: Año" },
    
    // TUS 6 CAMPOS
    { key: "dimension", label: "Dimensión" },
    { key: "subdimension", label: "Subdimensión" },
    { key: "nombre_accion", label: "Nombre Acción" },
    { key: "desc_accion", label: "Descripción Acción" },
    { key: "nombre_actividad", label: "Nombre Actividad" },
    { key: "desc_actividad", label: "Descripción Actividad" },

    // Extras
    { key: "recursos", label: "Lista de Insumos" },
    { key: "monto", label: "Monto Valorizado" },
    { key: "firma", label: "Espacio para Firma" }
]
    };

    // Seleccionar la configuración correcta según el tipo
    let config;
    if (tipo === "acciones") config = AppState.config.colsAcciones;
    else if (tipo === "recursos") config = AppState.config.colsRecursos;
    else if (tipo === "certificado") config = AppState.config.certFields; // <--- NUEVO

    defs[tipo].forEach(col => {
        const div = document.createElement("div");
        div.className = "flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer";
        div.onclick = (e) => { if (e.target.tagName !== "INPUT") div.querySelector("input").click(); };
        div.innerHTML = `
            <input type="checkbox" id="chk-${col.key}" ${config[col.key] ? "checked" : ""} class="w-5 h-5 text-blue-600 rounded">
            <label class="text-gray-700 cursor-pointer select-none">${col.label}</label>`;
        container.appendChild(div);
    });
    toggleModal("modal-config-columnas", true);
}

function guardarConfigColumnas() {
    const inputs = document.querySelectorAll("#lista-columnas input");
    const nuevaConfig = {};
    inputs.forEach(inp => nuevaConfig[inp.id.replace("chk-", "")] = inp.checked);

    if (tipoTablaConfigurando === "acciones") {
        nuevaConfig["opciones"] = true; // Siempre visible
        AppState.config.colsAcciones = nuevaConfig;
        if (AppState.acciones.length > 0) renderizarTablaAcciones(AppState.acciones);
    } 
    else if (tipoTablaConfigurando === "recursos") {
        nuevaConfig["opciones"] = true; // Siempre visible
        AppState.config.colsRecursos = nuevaConfig;
        if (AppState.recursosGlobales.length > 0) renderizarTablaRecursosGlobal(AppState.recursosGlobales);
    }
    else if (tipoTablaConfigurando === "certificado") {
        // NUEVO: Guardar config certificado
        AppState.config.certFields = nuevaConfig;
        alert("Configuración de certificado guardada.");
    }

    guardarConfiguracionLocal(); // Se guarda en LocalStorage automáticamente
    toggleModal("modal-config-columnas", false);
}

// --- Utils varios ---
function modalCrearColegio() {
    // Limpiar formulario
    setVal("col-nombre", ""); 
    setVal("col-rbd", ""); 
    setVal("col-rut", "");
    setVal("col-direccion", ""); 
    setVal("col-telefono", ""); 
    setVal("col-director", "");
    
    // NUEVO: Limpiar campo imagen
    setVal("col-imagen", ""); 

    toggleModal("modal-colegio", true);
}


async function guardarColegio(e) {
    e.preventDefault();

    const payload = {
        nombre: val("col-nombre"),
        rbd: val("col-rbd"),
        rut: val("col-rut"),
        direccion: val("col-direccion"),
        telefono: val("col-telefono"),
        director: val("col-director"),
        
        // NUEVO: Enviar lo que se escribió en el input (o null si está vacío)
        imagen: val("col-imagen") || null 
    };

    try {
        await apiCall('/colegios', 'POST', payload);
        alert("✅ Colegio registrado correctamente.");
        toggleModal("modal-colegio", false);
        cargarColegios(); 
    } catch (e) { 
        alert("Error: " + (e.detail || e)); 
    }
}



function cerrarConfigColumnas() { toggleModal("modal-config-columnas", false); }
function cerrarModalImportar() { toggleModal("modal-importar", false); }
function cerrarModalImportarRecursos() { toggleModal("modal-importar-recursos", false); }
function cerrarModalAsociar() { toggleModal("modal-asociar", false); }
function cerrarModalRecurso() { toggleModal("modal-recurso", false); }
function cerrarModalAccion() { toggleModal("modal-accion", false); }
function cerrarModalColegio() { toggleModal("modal-colegio", false); }
function cerrarModalPME() { toggleModal("modal-pme", false); }
function cerrarModalInsumo() { toggleModal("modal-insumo", false); }
function cerrarModalExportarRecursos() { toggleModal("modal-exportar-recursos", false); }

// ==========================================
// GENERACIÓN DE CERTIFICADO PDF
// ==========================================

// Variable temporal para guardar el nombre del archivo
let nombreArchivoPDF = "documento.pdf";


function mostrarModalCertificado(recurso, pmeData) {
    // 1. Obtener contextos (Acción y Colegio)
    const accion = AppState.acciones.find(a => a.uuid_accion === recurso.uuid_accion);
    const colegio = AppState.colegio || { nombre: "Sin Nombre", direccion: "", telefono: "", director: "", imagen: null };
    
    // Obtenemos la configuración de visualización
    const cfg = AppState.config.certFields; 

    // --- 2. GESTIÓN DE IMÁGENES (LOGO) ---
    const logoDefault = "https://cdn-icons-png.flaticon.com/512/8074/8074804.png";
    const urlLogo = (colegio.imagen && colegio.imagen.trim() !== "") ? colegio.imagen : logoDefault;

    const imgHeader = document.getElementById("pdf-header-logo");
    const imgFooter = document.getElementById("pdf-footer-logo");

    if (imgHeader) {
        imgHeader.src = urlLogo;
        imgHeader.style.display = 'block';
    }
    if (imgFooter) {
        imgFooter.src = urlLogo;
        imgFooter.style.display = 'block';
    }

    // --- 3. LLENADO DE TEXTOS (ENCABEZADO) ---
    txt("pdf-header-colegio", colegio.nombre);
    txt("pdf-header-rbd", colegio.rbd || "---");
    txt("pdf-header-rut", colegio.rut || "---");
    txt("pdf-header-direccion", colegio.direccion || "");
    txt("pdf-header-telefono", colegio.telefono || "");
    txt("pdf-header-year", `AÑO ${recurso.year}`);

    // --- 4. PREPARACIÓN DE VARIABLES DEL CUERPO ---
    
    // Dimensión
    const dimTexto = accion ? accion.dimension : (recurso.dimension || "S/D");

    // === CAMBIO AQUÍ: LÓGICA DE SUBDIMENSIÓN ===
    let subDimTexto = "General";

    // A. Prioridad 1: Usar la del Recurso/Actividad si existe
    if (recurso.subdimension && recurso.subdimension.trim() !== "") {
        subDimTexto = recurso.subdimension;
    } 
    // B. Prioridad 2: Usar la de la Acción (Array unido por comas)
    else if (accion && accion.subdimensiones && accion.subdimensiones.length > 0) {
        subDimTexto = accion.subdimensiones.join(", ");
    }
    // ===========================================

    const nomAccionTexto = accion ? accion.nombre_accion : "Sin Acción Asociada";
    const descAccionTexto = accion ? accion.descripcion : "---";
    const nomActividadTexto = recurso.nombre_actividad;
    const descActividadTexto = recurso.descripcion_actividad || "Sin detalle.";

    // --- 5. LLENADO DE TEXTOS (CUERPO) ---
    txt("pdf-dimension", dimTexto);
    txt("pdf-subdimension", subDimTexto); // Ahora muestra la del recurso preferentemente
    txt("pdf-nombre-accion", nomAccionTexto);
    txt("pdf-desc-accion", descAccionTexto);
    txt("pdf-nombre-actividad", nomActividadTexto);
    txt("pdf-desc-actividad", descActividadTexto);
    
    // Lista de Insumos
    const listaInsumos = (recurso.recursos_actividad && recurso.recursos_actividad.length > 0) 
                         ? recurso.recursos_actividad.join(", ") 
                         : "No requiere insumos específicos.";
    txt("pdf-lista-recursos", listaInsumos);

    // Monto
    const montoFmt = recurso.monto ? "$" + recurso.monto.toLocaleString("es-CL") : "$0";
    txt("pdf-monto", montoFmt);

    // --- 6. PIE DE PÁGINA ---
    txt("pdf-ciudad", "Alto Hospicio"); 
    txt("pdf-firma-director", colegio.director || "Director(a)");
    txt("pdf-firma-colegio", colegio.nombre);
    
    txt("pdf-footer-nombre", colegio.nombre);
    const infoPie = `${colegio.direccion || ""} ${colegio.telefono ? " - Fono: " + colegio.telefono : ""}`;
    txt("pdf-footer-direccion", infoPie);
    txt("pdf-uuid", recurso._id);


    // --- 7. CONTROL DE VISIBILIDAD (SEGÚN CONFIGURACIÓN) ---
    const rowDim = document.getElementById("pdf-row-dimension");
    if(rowDim) rowDim.className = cfg.dimension ? "border-b border-gray-100" : "hidden";

    const rowSub = document.getElementById("pdf-row-subdimension");
    if(rowSub) rowSub.className = cfg.subdimension ? "border-b border-gray-100" : "hidden";
    
    const rowAccNom = document.getElementById("pdf-row-accion-nombre");
    if(rowAccNom) rowAccNom.className = cfg.nombre_accion ? "bg-gray-50" : "hidden";

    const rowAccDesc = document.getElementById("pdf-row-accion-desc");
    if(rowAccDesc) rowAccDesc.className = cfg.desc_accion ? "" : "hidden";
    
    const rowActNom = document.getElementById("pdf-row-actividad-nombre");
    if(rowActNom) rowActNom.className = cfg.nombre_actividad ? "bg-gray-50" : "hidden";

    const rowActDesc = document.getElementById("pdf-row-actividad-desc");
    if(rowActDesc) rowActDesc.className = cfg.desc_actividad ? "" : "hidden";
    
    const rowRec = document.getElementById("pdf-row-recursos");
    if(rowRec) rowRec.className = cfg.recursos ? "" : "hidden";

    const rowMonto = document.getElementById("pdf-row-monto");
    if(rowMonto) rowMonto.className = cfg.monto ? "" : "hidden";

    const blockFirma = document.getElementById("pdf-footer-bloque");
    if(blockFirma) blockFirma.className = cfg.firma ? "flex justify-between items-end mb-2" : "hidden";

    // --- 8. MOSTRAR MODAL ---
    nombreArchivoPDF = `Certificado_${recurso.nombre_actividad.substring(0, 15).replace(/\s+/g, '_')}.pdf`;

    toggleModal("modal-certificado", true);
}

// --- FUNCIÓN PRINCIPAL DE CERTIFICADO ---
async function generarCertificado(idRecurso) {
    // 1. Buscar el recurso en memoria (global o local)
    let recurso = AppState.recursosGlobales.find(r => r._id === idRecurso);
    
    // Si no está en la lista global (porque estamos en la vista de detalle de acción), buscarlo allí
    if (!recurso && AppState.accionSeleccionada) {
        // Intentar buscar en la API si no lo tenemos a mano
        try {
            const res = await apiCall(`/recursos/${AppState.accionSeleccionada.uuid_accion}`);
            recurso = res.find(r => r._id === idRecurso);
        } catch (e) { console.error(e); }
    }

    if (!recurso) {
        return alert("Error: No se encontró la información del recurso. Intenta recargar.");
    }

    // 2. Obtener datos del PME actual para el Director
    // Si no tenemos el dato del director en memoria, lo buscamos rápido
    let pmeData = { director: "Director(a)" };
    if (AppState.idPme) {
        // Aquí podríamos hacer una llamada para obtener el PME completo si quisiéramos el nombre exacto del director
        // Por simplicidad, usaremos un placeholder o lo que tengamos
        // Idealmente, al cargar el contexto, deberíamos guardar el objeto PME completo en AppState
    }

    // 3. Llamar a la función que llena y abre el modal
    mostrarModalCertificado(recurso, pmeData);
}

// Helper para cargar dato si no está en memoria
async function cargarYMostrarCertificado(id) {
    try {
        const res = await apiCall(`/recursos/${AppState.accionSeleccionada.uuid_accion}`);
        const recurso = res.find(r => r._id === id);
        if(recurso) {
            mostrarModalCertificado(recurso);
        } else {
            alert("Error: Recurso no encontrado.");
        }
    } catch(e) { console.error(e); }
}

function cerrarModalCertificado() {
    const modal = document.getElementById("modal-certificado");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}


function descargarCertificadoPDF() {
    const element = document.getElementById('certificado-content');
    const btn = document.getElementById('btn-download-pdf');
    
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "Generando...";

    const opt = {
        margin:       0, 
        filename:     nombreArchivoPDF,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, 
            useCORS: true,
            scrollY: 0 
        },
        // CAMBIO AQUÍ: format: 'letter'
        jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    });
}


// Función auxiliar para obtener datos frescos y generar
async function generarPDFDesdeAPI(id) {
    // Buscamos la acción padre actual para obtener sus recursos
    if (AppState.accionSeleccionada) {
        try {
            const res = await apiCall(`/recursos/${AppState.accionSeleccionada.uuid_accion}`);
            const recursoEncontrado = res.find(r => r._id === id);
            if(recursoEncontrado) {
                crearPDF(recursoEncontrado);
            } else {
                alert("Error: No se encontró la información del recurso.");
            }
        } catch (e) { console.error(e); }
    }
}

function crearPDF(recurso) {
    // 1. Obtener datos de contexto (Acción Padre y Colegio)
    // Buscamos la acción asociada usando el uuid que tiene el recurso
    const accion = AppState.acciones.find(a => a.uuid_accion === recurso.uuid_accion);
    
    // Si no tenemos la acción en memoria (raro, pero posible), ponemos textos por defecto
    const nombreAccion = accion ? accion.nombre_accion : "Sin Acción Asociada / Huérfano";
    const dimension = accion ? accion.dimension : (recurso.dimension || "No definida");
    
    // Obtenemos el nombre del colegio del estado global
    const nombreColegio = AppState.colegio ? AppState.colegio.nombre : "Establecimiento Educacional";
    
    // 2. Formateo de datos
    // Formato de moneda chilena
    const montoFormateado = recurso.monto ? "$" + recurso.monto.toLocaleString("es-CL") : "$0";
    // Si hay lista de insumos la unimos con comas, si no, texto default
    const insumosTexto = (recurso.recursos_actividad || []).join(", ") || "No requiere insumos específicos";

    // 3. Inyectar datos en el HTML Oculto (Usando tu función helper txt)
    txt("pdf-nombre-actividad", recurso.nombre_actividad);
    txt("pdf-colegio", nombreColegio);
    txt("pdf-year", recurso.year);
    
    txt("pdf-accion", nombreAccion);
    txt("pdf-dimension", dimension);
    txt("pdf-responsable", recurso.responsable || "Sostenedor / Equipo de Gestión");
    txt("pdf-monto", montoFormateado);
    txt("pdf-insumos", insumosTexto);
    
    txt("pdf-uuid", recurso._id); // Mostramos el ID único al pie de página

    // 4. Preparar el elemento HTML
    const element = document.getElementById('certificado-template');
    
    // IMPORTANTE: Quitamos la clase hidden para que sea visible para la "cámara" del PDF
    element.classList.remove("hidden");

    // Configuración de la librería
    const opt = {
        margin:       0, // Sin márgenes (el diseño ya tiene padding)
        filename:     `Certificado_${recurso.nombre_actividad.substring(0, 15).replace(/\s+/g, '_')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2,       // Mejor calidad visual
            useCORS: true,  // Para cargar imágenes externas si las hubiera
            scrollY: 0      // <--- CLAVE: Asegura que capture desde arriba aunque hayas hecho scroll en la web
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // 5. Generar PDF con un pequeño retraso (Timeout)
    // El setTimeout le da tiempo al navegador (100ms) para renderizar el div 
    // antes de que html2pdf intente capturarlo. Esto evita la página en blanco.
    setTimeout(() => {
        html2pdf().set(opt).from(element).save()
        .then(() => {
            // Al terminar la descarga, volvemos a ocultar la plantilla
            element.classList.add("hidden");
        })
        .catch(err => {
            console.error("Error generando PDF:", err);
            alert("Hubo un error al generar el PDF.");
            element.classList.add("hidden"); // Aseguramos ocultarlo si falla
        });
    }, 100);
}


// --- EXPORTAR RECURSOS ---
function abrirModalExportarRecursos() { toggleModal("modal-exportar-recursos", true); }

function abrirModalExportarAccion() {
    toggleModal("modal-exportar-accion", true);
}

async function descargarExcelAccionDetalle() {
    if (!AppState.accionSeleccionada) return alert("Error: No hay acción seleccionada.");
    
    const uuid = AppState.accionSeleccionada.uuid_accion;
    const btn = $("btn-exp-acc-det");
    const originalText = btn.innerHTML;
    
    // 1. Obtener columnas del checkbox
    const checkboxes = document.querySelectorAll("#form-export-accion-cols input:checked");
    const columnasSeleccionadas = Array.from(checkboxes).map(cb => cb.value);

    if (columnasSeleccionadas.length === 0) return alert("Selecciona al menos una columna.");

    btn.disabled = true; 
    btn.innerHTML = "Generando...";

    try {
        // 2. Fetch Blob
        const blob = await apiCall(
            `/recursos/exportar_custom_accion/${uuid}`, 
            "POST", 
            { columnas: columnasSeleccionadas }
        );

        // 3. Descarga
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Nombre de archivo limpio
        const safeName = AppState.accionSeleccionada.nombre_accion.replace(/[^a-z0-9]/gi, '_').substring(0, 20);
        a.download = `Detalle_${safeName}.xlsx`;
        
        document.body.appendChild(a);
        a.click();
        
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        toggleModal("modal-exportar-accion", false);

    } catch (e) {
        // Si el backend responde 404 (json), apiCall lanza error.
        console.error(e);
        const msg = e.detail || "Error al descargar (¿Quizás la acción no tiene actividades?)";
        alert(msg);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}


async function descargarExcelRecursos() {
    if (!AppState.idPme) return alert("Contexto no definido");
    const btn = $("btn-descargar-rec");
    const original = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = "⏳";

    const checkboxes = document.querySelectorAll("#form-export-cols input:checked");
    const columnasSeleccionadas = Array.from(checkboxes).map(cb => cb.value);
    if (columnasSeleccionadas.length === 0) return alert("Selecciona columna");

    try {
        const res = await fetch(`${API}/recursos/exportar_custom/${AppState.idPme}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ columnas: columnasSeleccionadas })
        });
        if(!res.ok) throw await res.json();
        const blob = await res.blob();
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Recursos_${AppState.year}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toggleModal("modal-exportar-recursos", false);
    } catch(e) { alert("Error descarga: " + (e.detail || e)); }
    finally { btn.disabled = false; btn.innerHTML = original; }
}

// --- UTILIDAD (Si no la tienes, agrégala) ---
function normalizarTexto(texto) {
    if (!texto) return "";
    return texto.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}