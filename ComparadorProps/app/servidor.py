#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comparador de versiones de props — servidor local.

Guarda los archivos originales tal cual (sin recomprimir) en la carpeta
'biblioteca' y la ficha de cada version en 'biblioteca.db' (SQLite).

Para arrancar:  python app/servidor.py
"""

import base64
import json
import os
import re
import shutil
import sqlite3
import struct
import sys
import threading
import webbrowser
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

# ----------------------------------------------------------------------------
# Configuracion
# ----------------------------------------------------------------------------
PUERTO = 8777

# False = solo este PC.  True = visible para el equipo en la red del estudio.
# También se activa arrancando con "Abrir para el equipo.bat".
ABRIR_A_LA_RED = False

APP = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(APP)
WEB = os.path.join(APP, "web")
DATOS = os.path.join(RAIZ, "data")
BIBLIOTECA = os.path.join(DATOS, "biblioteca")
PAPELERA = os.path.join(DATOS, "papelera")
PROYECTOS = os.path.join(DATOS, "proyectos")
BD = os.path.join(DATOS, "biblioteca.db")
RESPALDOS = os.path.join(DATOS, "respaldos")

# El navegador envía las imágenes codificadas en base64. El límite de petición
# deja margen para esa codificación sin permitir que una subida agote la memoria.
MAX_IMAGEN_BYTES = 50 * 1024 * 1024
MAX_PETICION_BYTES = 70 * 1024 * 1024

TIPOS = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}

_candado = threading.Lock()


# ----------------------------------------------------------------------------
# Base de datos
# ----------------------------------------------------------------------------
def conectar():
    cx = sqlite3.connect(BD, timeout=10)
    cx.row_factory = sqlite3.Row
    return cx


def preparar_bd():
    os.makedirs(DATOS, exist_ok=True)
    os.makedirs(BIBLIOTECA, exist_ok=True)
    os.makedirs(PROYECTOS, exist_ok=True)
    os.makedirs(RESPALDOS, exist_ok=True)
    with conectar() as cx:
        cx.execute("""
            CREATE TABLE IF NOT EXISTS proyectos (
                nombre     TEXT PRIMARY KEY,
                produccion TEXT,
                logo       TEXT,
                plantilla  TEXT
            )
        """)
        cx.execute("""
            CREATE TABLE IF NOT EXISTS versiones (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                proyecto  TEXT    NOT NULL,
                episodio  TEXT    NOT NULL,
                shot      TEXT    NOT NULL,
                prop      TEXT    NOT NULL,
                numero    INTEGER NOT NULL,
                archivo   TEXT    NOT NULL,
                original  TEXT,
                ancho     INTEGER,
                alto      INTEGER,
                bytes     INTEGER,
                autor     TEXT,
                nota      TEXT,
                fecha     TEXT    NOT NULL
            )
        """)
        cx.execute("CREATE INDEX IF NOT EXISTS i_prop ON versiones(proyecto, episodio, shot, prop)")
        cx.execute("CREATE INDEX IF NOT EXISTS i_fecha ON versiones(fecha)")

        cx.execute("""
            CREATE TABLE IF NOT EXISTS notas (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                version  INTEGER NOT NULL,
                tipo     TEXT    NOT NULL,   -- pin | trazo | general
                datos    TEXT,               -- coordenadas, en JSON
                texto    TEXT,
                autor    TEXT,
                color    TEXT,
                resuelta INTEGER DEFAULT 0,
                fecha    TEXT    NOT NULL
            )
        """)
        cx.execute("CREATE INDEX IF NOT EXISTS i_notas ON notas(version)")

        # bases creadas antes de que existiera el tipo de asset
        columnas = [f["name"] for f in cx.execute("PRAGMA table_info(versiones)").fetchall()]
        if "tipo" not in columnas:
            cx.execute("ALTER TABLE versiones ADD COLUMN tipo TEXT DEFAULT ''")
        for nueva in ("estado", "visto_por", "visto_fecha"):
            if nueva not in columnas:
                cx.execute("ALTER TABLE versiones ADD COLUMN %s TEXT DEFAULT ''" % nueva)


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def limpiar(texto):
    """Convierte un nombre en algo seguro para usar como carpeta."""
    t = re.sub(r"[^\w\-. ]", "_", (texto or "").strip(), flags=re.UNICODE)
    return re.sub(r"\s+", "_", t)[:80] or "sin_nombre"


def medir_imagen(datos):
    """Lee ancho y alto sin librerias externas (PNG, JPEG, GIF)."""
    try:
        if datos[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", datos[16:24])
            return int(w), int(h)
        if datos[:3] == b"\xff\xd8\xff":
            i = 2
            while i < len(datos) - 9:
                if datos[i] != 0xFF:
                    i += 1
                    continue
                marca = datos[i + 1]
                largo = struct.unpack(">H", datos[i + 2:i + 4])[0]
                if marca in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                             0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", datos[i + 5:i + 9])
                    return int(w), int(h)
                i += 2 + largo
        if datos[:6] in (b"GIF87a", b"GIF89a"):
            w, h = struct.unpack("<HH", datos[6:10])
            return int(w), int(h)
    except Exception:
        pass
    return 0, 0


def formato_imagen(datos):
    """Devuelve la extensión según los bytes reales, o None si no es una imagen admitida."""
    if datos.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if datos.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if datos[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return ".webp"
    if datos[:4] in (b"II*\x00", b"MM\x00*"):
        return ".tif"
    return None


def decodificar_imagen(valor):
    """Decodifica y valida una carga antes de escribirla en disco."""
    if not isinstance(valor, str):
        raise ValueError("Falta la imagen")
    try:
        datos = base64.b64decode(valor, validate=True)
    except (ValueError, TypeError):
        raise ValueError("La imagen no está codificada correctamente")
    if not datos:
        raise ValueError("La imagen está vacía")
    if len(datos) > MAX_IMAGEN_BYTES:
        raise ValueError("La imagen supera el límite de 50 MB")
    extension = formato_imagen(datos)
    if not extension:
        raise ValueError("Formato no admitido. Usa PNG, JPG, GIF, WebP o TIFF")
    return datos, extension


def ruta_segura(raiz, relativa):
    """Resuelve una ruta y garantiza que no salga de su carpeta autorizada."""
    raiz_real = os.path.realpath(raiz)
    destino = os.path.realpath(os.path.join(raiz_real, relativa))
    if os.path.commonpath((raiz_real, destino)) != raiz_real:
        raise ValueError("Ruta no permitida")
    return destino


def respaldar_bd():
    """Mantiene una copia consistente de la base de datos del día actual."""
    if not os.path.isfile(BD):
        return
    destino = os.path.join(RESPALDOS, "biblioteca-%s.db" % datetime.now().strftime("%Y-%m-%d"))
    with conectar() as origen, sqlite3.connect(destino) as copia:
        origen.backup(copia)


# ----------------------------------------------------------------------------
# Operaciones
# ----------------------------------------------------------------------------
def arbol():
    """Devuelve proyecto > episodio > shot > prop, con conteo de versiones."""
    with conectar() as cx:
        filas = cx.execute("""
            SELECT proyecto, episodio, shot, prop, MAX(tipo) AS tipo,
                   COUNT(*) AS total, MAX(fecha) AS ultima,
                   (SELECT estado FROM versiones v2
                     WHERE v2.proyecto=versiones.proyecto AND v2.episodio=versiones.episodio
                       AND v2.shot=versiones.shot AND v2.prop=versiones.prop
                     ORDER BY numero DESC LIMIT 1) AS estado
            FROM versiones
            GROUP BY proyecto, episodio, shot, prop
            ORDER BY proyecto, episodio, shot, prop
        """).fetchall()
    salida = {}
    for f in filas:
        p = salida.setdefault(f["proyecto"], {})
        e = p.setdefault(f["episodio"], {})
        s = e.setdefault(f["shot"], [])
        s.append({"prop": f["prop"], "total": f["total"], "ultima": f["ultima"],
                  "tipo": f["tipo"] or "", "estado": f["estado"] or ""})
    return salida


def versiones_de(proyecto, episodio, shot, prop):
    with conectar() as cx:
        filas = cx.execute("""
            SELECT id, numero, original, ancho, alto, bytes, autor, nota, fecha, tipo,
                   estado, visto_por, visto_fecha
            FROM versiones
            WHERE proyecto=? AND episodio=? AND shot=? AND prop=?
            ORDER BY numero
        """, (proyecto, episodio, shot, prop)).fetchall()
    return [dict(f) for f in filas]


def guardar_version(d):
    datos, extension = decodificar_imagen(d.get("datos"))
    ancho, alto = medir_imagen(datos)
    proyecto = (d.get("proyecto") or "").strip()
    episodio = (d.get("episodio") or "").strip()
    shot = (d.get("shot") or "").strip()
    prop = (d.get("prop") or "").strip()
    if not (proyecto and episodio and shot and prop):
        raise ValueError("Faltan proyecto, episodio, shot o prop")

    with _candado:
        with conectar() as cx:
            fila = cx.execute("""
                SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente
                FROM versiones WHERE proyecto=? AND episodio=? AND shot=? AND prop=?
            """, (proyecto, episodio, shot, prop)).fetchone()
            numero = fila["siguiente"]

            carpeta = os.path.join(BIBLIOTECA, limpiar(proyecto), limpiar(episodio),
                                   limpiar(shot), limpiar(prop))
            os.makedirs(carpeta, exist_ok=True)
            relativa = os.path.join(
                limpiar(proyecto), limpiar(episodio), limpiar(shot), limpiar(prop),
                "v%03d%s" % (numero, extension))

            # se escriben los bytes originales, sin tocar ni recomprimir
            with open(os.path.join(BIBLIOTECA, relativa), "wb") as f:
                f.write(datos)

            cur = cx.execute("""
                INSERT INTO versiones
                    (proyecto, episodio, shot, prop, numero, archivo, original,
                     ancho, alto, bytes, autor, nota, fecha, tipo)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (proyecto, episodio, shot, prop, numero, relativa.replace("\\", "/"),
                  d.get("nombre", ""), ancho, alto, len(datos),
                  (d.get("autor") or "").strip(), (d.get("nota") or "").strip(),
                  datetime.now().isoformat(timespec="seconds"),
                  (d.get("tipo") or "").strip()))
            nuevo = cur.lastrowid

    respaldar_bd()
    return {"id": nuevo, "numero": numero, "ancho": ancho, "alto": alto}


def avance(dias):
    """Props con versiones nuevas en los ultimos N dias, listos para comparar."""
    desde = (datetime.now() - timedelta(days=int(dias))).isoformat(timespec="seconds")
    with conectar() as cx:
        nuevas = cx.execute("""
            SELECT proyecto, episodio, shot, prop,
                   MAX(numero) AS numero, COUNT(*) AS subidas, MAX(fecha) AS fecha
            FROM versiones WHERE fecha >= ?
            GROUP BY proyecto, episodio, shot, prop
            ORDER BY fecha DESC
        """, (desde,)).fetchall()

        salida = []
        for f in nuevas:
            clave = (f["proyecto"], f["episodio"], f["shot"], f["prop"])
            nueva = cx.execute("""
                SELECT id, numero FROM versiones
                WHERE proyecto=? AND episodio=? AND shot=? AND prop=? AND numero=?
            """, clave + (f["numero"],)).fetchone()
            previa = cx.execute("""
                SELECT id, numero FROM versiones
                WHERE proyecto=? AND episodio=? AND shot=? AND prop=? AND numero < ?
                ORDER BY numero DESC LIMIT 1
            """, clave + (f["numero"],)).fetchone()
            salida.append({
                "proyecto": f["proyecto"], "episodio": f["episodio"],
                "shot": f["shot"], "prop": f["prop"],
                "subidas": f["subidas"], "fecha": f["fecha"],
                "nueva": dict(nueva) if nueva else None,
                "previa": dict(previa) if previa else None,
            })
    return salida


def borrar(d):
    """Elimina un proyecto, episodio, shot o prop entero.
    Los archivos no se destruyen: se mueven a la carpeta 'papelera'."""
    orden = ["proyecto", "episodio", "shot", "prop"]
    claves = [k for k in orden if (d.get(k) or "").strip()]
    if not claves or claves != orden[:len(claves)]:
        raise ValueError("No se indicó bien qué eliminar")

    donde = " AND ".join("%s=?" % k for k in claves)
    valores = [d[k] for k in claves]
    marca = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    with _candado:
        with conectar() as cx:
            filas = cx.execute("SELECT id, archivo FROM versiones WHERE " + donde, valores).fetchall()
            for f in filas:
                origen = os.path.join(BIBLIOTECA, f["archivo"].replace("/", os.sep))
                destino = os.path.join(PAPELERA, marca, f["archivo"].replace("/", os.sep))
                if os.path.isfile(origen):
                    os.makedirs(os.path.dirname(destino), exist_ok=True)
                    shutil.move(origen, destino)
            ids = [r["id"] for r in cx.execute("SELECT id FROM versiones WHERE " + donde, valores)]
            if ids:
                cx.execute("DELETE FROM notas WHERE version IN (%s)" % ",".join("?"*len(ids)), ids)
            cx.execute("DELETE FROM versiones WHERE " + donde, valores)

    quitar_carpetas_vacias(BIBLIOTECA)
    respaldar_bd()
    return {"eliminadas": len(filas), "papelera": os.path.join("papelera", marca)}


def quitar_carpetas_vacias(raiz):
    for actual, carpetas, archivos in os.walk(raiz, topdown=False):
        if actual != raiz and not carpetas and not archivos:
            try:
                os.rmdir(actual)
            except OSError:
                pass


def listar_proyectos():
    with conectar() as cx:
        filas = cx.execute("SELECT nombre, produccion, logo, plantilla FROM proyectos ORDER BY nombre").fetchall()
    return [dict(f) for f in filas]


def guardar_proyecto(d):
    nombre = (d.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("El proyecto necesita un nombre")

    logo = d.get("logo_actual") or ""
    if not logo:
        with conectar() as cx:
            fila = cx.execute("SELECT logo FROM proyectos WHERE nombre=?", (nombre,)).fetchone()
            if fila:
                logo = fila["logo"] or ""
    if d.get("logo_datos"):
        datos, extension = decodificar_imagen(d.get("logo_datos"))
        archivo = limpiar(nombre) + extension
        with open(os.path.join(PROYECTOS, archivo), "wb") as f:
            f.write(datos)
        logo = archivo

    with conectar() as cx:
        cx.execute("""
            INSERT INTO proyectos (nombre, produccion, logo, plantilla) VALUES (?,?,?,?)
            ON CONFLICT(nombre) DO UPDATE SET produccion=excluded.produccion,
                logo=excluded.logo, plantilla=excluded.plantilla
        """, (nombre, (d.get("produccion") or "").strip(), logo, (d.get("plantilla") or "").strip()))
    respaldar_bd()
    return {"nombre": nombre, "logo": logo}


def borrar_proyecto(nombre):
    with conectar() as cx:
        cx.execute("DELETE FROM proyectos WHERE nombre=?", (nombre,))
    respaldar_bd()
    return {"ok": True}


def notas_de(id_version):
    with conectar() as cx:
        filas = cx.execute("""
            SELECT id, tipo, datos, texto, autor, color, resuelta, fecha
            FROM notas WHERE version=? ORDER BY id
        """, (id_version,)).fetchall()
    salida = []
    for f in filas:
        n = dict(f)
        try:
            n["datos"] = json.loads(n["datos"] or "null")
        except Exception:
            n["datos"] = None
        salida.append(n)
    return salida


def guardar_nota_visual(d):
    with conectar() as cx:
        cur = cx.execute("""
            INSERT INTO notas (version, tipo, datos, texto, autor, color, resuelta, fecha)
            VALUES (?,?,?,?,?,?,0,?)
        """, (int(d["version"]), d.get("tipo", "general"),
              json.dumps(d.get("datos")), (d.get("texto") or "").strip(),
              (d.get("autor") or "").strip(), d.get("color") or "#ff3b30",
              datetime.now().isoformat(timespec="seconds")))
    respaldar_bd()
    return {"id": cur.lastrowid}


def actualizar_nota(d):
    campos, valores = [], []
    if "texto" in d:
        campos.append("texto=?"); valores.append((d.get("texto") or "").strip())
    if "resuelta" in d:
        campos.append("resuelta=?"); valores.append(1 if d["resuelta"] else 0)
    if not campos:
        return {"ok": True}
    valores.append(int(d["id"]))
    with conectar() as cx:
        cx.execute("UPDATE notas SET " + ", ".join(campos) + " WHERE id=?", valores)
    respaldar_bd()
    return {"ok": True}


def borrar_nota(id_nota):
    with conectar() as cx:
        cx.execute("DELETE FROM notas WHERE id=?", (int(id_nota),))
    respaldar_bd()
    return {"ok": True}


def marcar_estado(d):
    """Deja registrado quién aprobó o pidió cambios, y cuándo."""
    estado = (d.get("estado") or "").strip()
    if estado not in ("", "aprobado", "cambios"):
        raise ValueError("Estado no válido")
    quien = (d.get("quien") or "").strip()
    cuando = datetime.now().isoformat(timespec="seconds") if estado else ""
    with conectar() as cx:
        cx.execute("UPDATE versiones SET estado=?, visto_por=?, visto_fecha=? WHERE id=?",
                   (estado, quien if estado else "", cuando, int(d["id"])))
    respaldar_bd()
    return {"estado": estado, "visto_por": quien, "visto_fecha": cuando}


def poner_nota(id_version, nota):
    with conectar() as cx:
        cx.execute("UPDATE versiones SET nota=? WHERE id=?", (nota.strip(), id_version))
    respaldar_bd()


# ----------------------------------------------------------------------------
# Servidor
# ----------------------------------------------------------------------------
class Manejador(BaseHTTPRequestHandler):
    server_version = "ComparadorProps"

    def log_message(self, formato, *args):
        pass  # sin ruido en la consola

    # -- respuestas ----------------------------------------------------------
    def responder(self, codigo, cuerpo, tipo="application/json; charset=utf-8", cache=False):
        if isinstance(cuerpo, str):
            cuerpo = cuerpo.encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control",
                         "public, max-age=31536000, immutable" if cache else "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def json(self, datos, codigo=200):
        self.responder(codigo, json.dumps(datos, ensure_ascii=False))

    def error(self, mensaje, codigo=400):
        self.json({"error": mensaje}, codigo)

    # -- GET -----------------------------------------------------------------
    def do_GET(self):
        ruta = urlparse(self.path)
        camino = unquote(ruta.path)
        consulta = parse_qs(ruta.query)

        try:
            if camino in ("/", "/index.html"):
                return self.estatico(os.path.join(WEB, "index.html"))

            if camino == "/api/arbol":
                return self.json(arbol())

            if camino == "/api/versiones":
                faltan = [k for k in ("proyecto", "episodio", "shot", "prop") if k not in consulta]
                if faltan:
                    return self.error("Faltan datos: " + ", ".join(faltan))
                return self.json(versiones_de(*[consulta[k][0] for k in
                                                ("proyecto", "episodio", "shot", "prop")]))

            if camino == "/api/proyectos":
                return self.json(listar_proyectos())

            if camino.startswith("/logo/"):
                archivo = os.path.basename(unquote(camino[6:]))
                return self.estatico(ruta_segura(PROYECTOS, archivo), cache=False)

            if camino == "/api/notas":
                return self.json(notas_de(int(consulta.get("version", ["0"])[0])))

            if camino == "/api/avance":
                return self.json(avance(consulta.get("dias", ["7"])[0]))

            if camino.startswith("/archivo/"):
                id_version = int(camino.rsplit("/", 1)[1])
                with conectar() as cx:
                    fila = cx.execute("SELECT archivo FROM versiones WHERE id=?",
                                      (id_version,)).fetchone()
                if not fila:
                    return self.error("Esa version no existe", 404)
                destino = ruta_segura(BIBLIOTECA, fila["archivo"].replace("/", os.sep))
                return self.estatico(destino, cache=True)

            if camino.startswith("/web/"):
                return self.estatico(ruta_segura(WEB, camino[5:]))

            return self.error("Ruta desconocida", 404)

        except Exception as e:
            return self.error(str(e), 500)

    # -- POST ----------------------------------------------------------------
    def do_POST(self):
        camino = urlparse(self.path).path
        try:
            largo = int(self.headers.get("Content-Length", 0))
            if largo <= 0:
                return self.error("La petición no contiene datos")
            if largo > MAX_PETICION_BYTES:
                return self.error("La petición supera el límite de 70 MB", 413)
            cuerpo = json.loads(self.rfile.read(largo) or b"{}")

            if camino == "/api/subir":
                return self.json(guardar_version(cuerpo))

            if camino == "/api/proyecto":
                return self.json(guardar_proyecto(cuerpo))

            if camino == "/api/proyecto-borrar":
                return self.json(borrar_proyecto((cuerpo.get("nombre") or "").strip()))

            if camino == "/api/estado":
                return self.json(marcar_estado(cuerpo))

            if camino == "/api/nota-visual":
                return self.json(guardar_nota_visual(cuerpo))

            if camino == "/api/nota-editar":
                return self.json(actualizar_nota(cuerpo))

            if camino == "/api/nota-quitar":
                return self.json(borrar_nota(cuerpo["id"]))

            if camino == "/api/borrar":
                return self.json(borrar(cuerpo))

            if camino == "/api/nota":
                poner_nota(int(cuerpo["id"]), cuerpo.get("nota", ""))
                return self.json({"ok": True})

            return self.error("Ruta desconocida", 404)

        except Exception as e:
            return self.error(str(e), 400)

    # -- archivos ------------------------------------------------------------
    def estatico(self, destino, cache=False):
        if not os.path.isfile(destino):
            return self.error("No se encontro el archivo", 404)
        extension = os.path.splitext(destino)[1].lower()
        with open(destino, "rb") as f:
            self.responder(200, f.read(), TIPOS.get(extension, "application/octet-stream"), cache)


def ip_de_esta_maquina():
    """Averigua la IP que ven los demás en la red."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def arrancar():
    preparar_bd()
    respaldar_bd()
    en_red = ABRIR_A_LA_RED or "--red" in sys.argv
    direccion = "0.0.0.0" if en_red else "127.0.0.1"
    servidor = ThreadingHTTPServer((direccion, PUERTO), Manejador)
    url = "http://localhost:%d/" % PUERTO

    print("=" * 58)
    if en_red:
        ip = ip_de_esta_maquina()
        print("  MODO EQUIPO — visible en la red del estudio")
        print("")
        print("  Tus companeros entran a:   http://%s:%d" % (ip or "TU-IP", PUERTO))
        print("  Tu puedes seguir usando:   %s" % url)
        print("")
        print("  Si Windows pregunta por el firewall, acepta en redes privadas.")
    else:
        print("  MODO PRIVADO — solo este PC")
        print("")
        print("  Abierto en:  %s" % url)
        print("")
        print("  Para que lo vea el equipo, cierra esta ventana y abre")
        print("  'Abrir para el equipo.bat' en vez de 'Abrir comparador.bat'.")
    print("")
    print("  Biblioteca: %s" % BIBLIOTECA)
    print("  Para detenerlo: Ctrl + C")
    print("=" * 58)

    try:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    arrancar()
