"""Servidor local: esta PC guarda los datos de la página y recibe los documentos que envían los efectivos.

Solo biblioteca estándar. Los datos quedan en datos_servidor/ y no salen de esta PC.
El administrador entra desde esta misma PC (127.0.0.1) sin contraseña; desde otro equipo, con contraseña.
Cada efectivo entra solo con su enlace personal (/e/<código>) y ve únicamente sus carpetas pendientes.
"""
import argparse
import base64
import datetime as dt
import hashlib
import hmac
import html
import http.server
import ipaddress
import json
import math
import re
import secrets
import shutil
import socket
import socketserver
import sqlite3
import sys
import threading
import unicodedata
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PAGINA = ROOT / 'outputs/pagina_web_ventanilla'
HTML_PAGINA = PAGINA / 'CARPETAS_FISCALES_VENTANILLA.html'
MARCA = '<script type="application/json" id="servidor">null</script>'
MAX_ARCHIVO = 25 * 1024 * 1024
MAX_ESTADO = 20 * 1024 * 1024
MAX_RESTAURACION = 128 * 1024 * 1024
VERSION_SERVIDOR = '2026.11.04.2'
MIME_DOCUMENTOS = {'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif'}
TIPOS_ENVIO = {'informe': 'Informe policial', 'cargo': 'Cargo de remisión a la Fiscalía', 'otro': 'Otro documento', 'ampliacion': 'Ampliación de investigación'}
# Lo que el efectivo puede elegir hoy (decisión del usuario); los demás tipos quedan para mostrar envíos anteriores.
TIPOS_PORTAL = ('cargo', 'ampliacion')
ESTADOS_ENVIO = {'nuevo': 'Enviado, por revisar', 'aceptado': 'Recibido', 'revisado': 'Revisado', 'rechazado': 'Observado: vuelve a enviarlo'}

args = argparse.ArgumentParser()
args.add_argument('--datos', default=str(ROOT / 'datos_servidor'))
args.add_argument('--puerto', type=int, default=8765)
args.add_argument('--clave', action='store_true', help='Pide una contraseña nueva para entrar desde otro equipo y termina.')
args.add_argument('--remoto', choices=('si', 'no'), help='Activa o quita el acceso por Tailscale y termina.')
args.add_argument('--ip-remota', default='', help=argparse.SUPPRESS)  # solo para pruebas
args.add_argument('--probar-remoto', action='store_true', help=argparse.SUPPRESS)  # solo para pruebas: nadie cuenta como esta PC
args.add_argument('--pagina', help=argparse.SUPPRESS)  # página ficticia para pruebas aisladas
A = args.parse_args()
if A.pagina:
    HTML_PAGINA = Path(A.pagina).resolve()
    PAGINA = HTML_PAGINA.parent
DATOS = Path(A.datos)
DATOS.mkdir(parents=True, exist_ok=True)
DB_RUTA = DATOS / 'carpetas.db'
CONFIG = DATOS / 'config.json'


def leer_config():
    try:
        return json.loads(CONFIG.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'red_local': False}


def publicacion_personal():
    """Una entrada caída o sin señal reciente nunca sustituye los enlaces privados."""
    try:
        dato = json.loads((DATOS / 'acceso_internet.json').read_text(encoding='utf-8'))
        edad = dt.datetime.now().timestamp() - float(dato.get('senal', 0))
        u = urllib.parse.urlsplit(dato.get('portal', ''))
        if dato.get('activo') is not True or not 0 <= edad < 90 or u.scheme != 'https' or not u.hostname or u.username or u.password or u.port or u.path not in ('', '/') or u.query or u.fragment:
            return None
        entrada = dato.get('entrada', '')
        if entrada and entrada != 'https://numbrsword.github.io/mis-carpetas/':
            entrada = ''
        return {'portal': u.geturl().rstrip('/'), 'entrada': entrada, 'temporal': True}
    except (OSError, ValueError, TypeError):
        return None


def hash_clave(clave, sal):
    return hashlib.pbkdf2_hmac('sha256', clave.encode('utf-8'), bytes.fromhex(sal), 200_000).hex()


if A.clave:
    import getpass
    c1 = getpass.getpass('Contraseña nueva (mínimo 10 caracteres): ')
    if len(c1) < 10 or c1 != getpass.getpass('Repítela: '):
        sys.exit('No coinciden o es muy corta. No se cambió nada.')
    cfg = leer_config()
    sal = secrets.token_hex(16)
    cfg['clave'] = {'sal': sal, 'hash': hash_clave(c1, sal)}
    CONFIG.write_text(json.dumps(cfg, indent=1), encoding='utf-8')
    print('Contraseña guardada.')
    sys.exit(0)
if A.remoto:
    cfg = leer_config()
    cfg['tailscale'] = A.remoto == 'si'
    CONFIG.write_text(json.dumps(cfg, indent=1), encoding='utf-8')
    print('Acceso por Tailscale', 'activado.' if cfg['tailscale'] else 'quitado.')
    if cfg['tailscale'] and not cfg.get('clave'):
        print('Aún no hay contraseña: ejecuta CAMBIAR CONTRASENA.bat para poder entrar tú desde otro equipo.')
    sys.exit(0)

# --- Base de datos ---
bd = sqlite3.connect(DB_RUTA, check_same_thread=False)
bd.executescript("""
CREATE TABLE IF NOT EXISTS estado(id INTEGER PRIMARY KEY CHECK(id=1), datos TEXT NOT NULL, version INTEGER NOT NULL, fecha TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS historial(id INTEGER PRIMARY KEY AUTOINCREMENT, datos TEXT NOT NULL, version INTEGER, fecha TEXT);
CREATE TABLE IF NOT EXISTS adjuntos(clave TEXT PRIMARY KEY, nombre TEXT, tipo TEXT, datos BLOB, fecha TEXT);
CREATE TABLE IF NOT EXISTS enlaces(efectivo TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, fecha TEXT);
CREATE TABLE IF NOT EXISTS envios(id INTEGER PRIMARY KEY AUTOINCREMENT, efectivo TEXT, carpeta TEXT, tipo TEXT, nota TEXT,
  nombre TEXT, mime TEXT, datos BLOB, tam INTEGER, fecha TEXT, estado TEXT DEFAULT 'nuevo', revisado TEXT);
CREATE TABLE IF NOT EXISTS cuentas(efectivo TEXT PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, sal TEXT NOT NULL, hash TEXT NOT NULL,
  cambiar INTEGER NOT NULL DEFAULT 1, fallos INTEGER NOT NULL DEFAULT 0, bloqueo REAL NOT NULL DEFAULT 0, fecha TEXT);
""")
bd.commit()
candado = threading.RLock()
aviso_respaldo = threading.Event()
estado_respaldo = {'fecha': '', 'pendiente': False, 'error': ''}


def ahora():
    return dt.datetime.now().isoformat(timespec='seconds')


def copiar_base(destino):
    """Publica una copia completa solo después de comprobar que SQLite la cerró bien."""
    temporal = destino.with_name(destino.name + '.' + secrets.token_hex(6) + '.tmp')
    try:
        with candado:
            copia = sqlite3.connect(temporal)
            try:
                bd.backup(copia)
                if copia.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise sqlite3.DatabaseError('La copia no pasó la comprobación')
            finally:
                copia.close()
        temporal.replace(destino)
    finally:
        temporal.unlink(missing_ok=True)


def programar_respaldo():
    estado_respaldo['pendiente'] = True
    aviso_respaldo.set()


def respaldo_diario():
    """Actualiza la copia del día; conserva las últimas 30, sin publicar copias a medias."""
    carpeta = DATOS / 'respaldos'
    carpeta.mkdir(exist_ok=True)
    destino = carpeta / ('carpetas_' + dt.date.today().isoformat() + '.db')
    with candado:
        copiar_base(destino)
        estado_respaldo.update(fecha=ahora(), pendiente=False, error='')
        for viejo in sorted(carpeta.glob('carpetas_20??-??-??.db'))[:-30]:
            viejo.unlink()


def mantener_respaldos():
    while True:
        aviso_respaldo.wait()
        # Agrupa pulsaciones cercanas; como máximo unos segundos de retraso.
        threading.Event().wait(2)
        aviso_respaldo.clear()
        try:
            respaldo_diario()
        except (OSError, sqlite3.Error):
            estado_respaldo.update(error='No se pudo actualizar la copia. Revisa el espacio y los permisos de la carpeta.', pendiente=True)
            threading.Event().wait(30)
            aviso_respaldo.set()


def estado_actual():
    with candado:
        fila = bd.execute('SELECT datos, version FROM estado WHERE id=1').fetchone()
    return (json.loads(fila[0]), fila[1]) if fila else (None, 0)


def consultar(sql, parametros=(), uno=False):
    with candado:
        consulta = bd.execute(sql, parametros)
        return consulta.fetchone() if uno else consulta.fetchall()


def validar_estado(store):
    """Rechaza respaldos rotos antes de reemplazar el estado válido."""
    if not isinstance(store, dict):
        return False
    if not isinstance(store.get('edits'), dict) or not isinstance(store.get('nuevos'), list):
        return False
    if not isinstance(store.get('cfg'), dict) or not isinstance(store.get('efectivos'), list):
        return False
    def seguro(v, nivel=0):
        if nivel > 30:
            return False
        if isinstance(v, dict):
            return all(k not in ('__proto__', 'constructor', 'prototype') and seguro(x, nivel + 1) for k, x in v.items())
        if isinstance(v, list):
            return all(seguro(x, nivel + 1) for x in v)
        return not isinstance(v, float) or math.isfinite(v)
    if not seguro(store):
        return False
    aviso = store['cfg'].get('aviso', 7)
    if type(aviso) is not int or not 0 <= aviso <= 365:
        return False
    if any(not isinstance(v, dict) for v in store['edits'].values()):
        return False
    for campo in ('nuevos', 'efectivos'):
        ids = set()
        for fila in store[campo]:
            if not isinstance(fila, dict) or not isinstance(fila.get('id'), str) or not fila['id'] or fila['id'] in ids:
                return False
            ids.add(fila['id'])
    return True


def guardar_estado(store, version):
    with candado:
        previo, actual = estado_actual()
        if version != actual:
            # Si se perdió solo la respuesta, reintentar el mismo estado no crea un conflicto.
            if store == previo:
                return True, actual
            return False, actual
        with bd:
            escribir_estado(store, actual + 1)
        programar_respaldo()
        return True, actual + 1


def escribir_estado(store, version):
    anterior = bd.execute('SELECT datos, version, fecha FROM estado WHERE id=1').fetchone()
    if anterior:
        bd.execute('INSERT INTO historial(datos, version, fecha) VALUES (?,?,?)', anterior)
        bd.execute('DELETE FROM historial WHERE id NOT IN (SELECT id FROM historial ORDER BY id DESC LIMIT 200)')
    bd.execute('INSERT OR REPLACE INTO estado(id, datos, version, fecha) VALUES (1,?,?,?)', (json.dumps(store, ensure_ascii=False), version, ahora()))


def preparar_restauracion(cuerpo):
    if not isinstance(cuerpo, dict) or not validar_estado(cuerpo.get('store')):
        raise ValueError('Respaldo no válido.')
    if type(cuerpo.get('version')) is not int or cuerpo['version'] < 0:
        raise ValueError('Versión no válida.')
    if len(json.dumps(cuerpo['store'], ensure_ascii=False).encode('utf-8')) > MAX_ESTADO:
        raise ValueError('Los datos del respaldo exceden el límite de 20 MB.')
    lista = cuerpo.get('adjuntos', [])
    if not isinstance(lista, list):
        raise ValueError('Lista de documentos no válida.')
    claves, archivos = set(), []
    for a in lista:
        if not isinstance(a, dict) or not isinstance(a.get('clave'), str) or not 1 <= len(a['clave']) <= 200 or a['clave'] in claves:
            raise ValueError('Documento repetido o sin identificación.')
        if not isinstance(a.get('datos'), str) or len(a['datos']) > ((MAX_ARCHIVO + 2) // 3) * 4:
            raise ValueError('Documento no válido o mayor de 25 MB.')
        datos = base64.b64decode(a['datos'], validate=True)
        if not 1 <= len(datos) <= MAX_ARCHIVO:
            raise ValueError('Documento vacío o mayor de 25 MB.')
        nombre, tipo = a.get('nombre', 'documento'), a.get('tipo', 'application/octet-stream')
        if not isinstance(nombre, str) or not isinstance(tipo, str) or '\r' in tipo or '\n' in tipo:
            raise ValueError('Nombre o tipo de documento no válido.')
        claves.add(a['clave'])
        archivos.append((a['clave'], nombre[:200], tipo[:100], datos, ahora()))
    return archivos


def restaurar_estado(cuerpo, archivos):
    with candado:
        _, version = estado_actual()
        if cuerpo['version'] != version:
            return False, version
        carpeta = DATOS / 'respaldos'
        carpeta.mkdir(exist_ok=True)
        destino = carpeta / ('antes_restaurar_' + dt.datetime.now().strftime('%Y%m%d_%H%M%S_') + secrets.token_hex(4) + '.db')
        copiar_base(destino)  # Si falla la copia, no se cambia nada.
        with bd:
            escribir_estado(cuerpo['store'], version + 1)
            bd.executemany('INSERT OR REPLACE INTO adjuntos VALUES (?,?,?,?,?)', archivos)
        programar_respaldo()
        return True, version + 1


# --- Carpetas de cada efectivo, para su enlace ---
_cache = {'mtime': None, 'base': []}


def base_pagina():
    m = HTML_PAGINA.stat().st_mtime
    if _cache['mtime'] != m:
        t = HTML_PAGINA.read_text(encoding='utf-8')
        j = re.search(r'<script type="application/json" id="base">(.*?)</script>', t, re.S).group(1)
        _cache.update(mtime=m, base=json.loads(j.replace('<\\/', '</')))
    return _cache['base']


def norm(v):
    return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFD', str(v or '').upper()) if unicodedata.category(c) != 'Mn')).strip()


def carpetas_de(efectivo_id, incluir_cerradas=False):
    store, _ = estado_actual()
    if not store:
        return None, []
    ef = next((e for e in store.get('efectivos', []) if e.get('id') == efectivo_id), None)
    if not ef:
        return None, []
    clave = ' '.join(norm(ef.get('nombre')).split()[:2])
    edits = store.get('edits', {})
    hoy = dt.date.today().isoformat()
    dias_aviso = store.get('cfg', {}).get('aviso', 7)
    if type(dias_aviso) is not int or not 0 <= dias_aviso <= 365:
        dias_aviso = 7
    aviso = (dt.date.today() + dt.timedelta(days=dias_aviso)).isoformat()
    res = []
    for r in base_pagina() + store.get('nuevos', []):
        r = {**r, **edits.get(r['id'], {})}
        # Un decreto adicional (adic) no es otra carpeta.
        if r.get('adic') or not clave or clave not in norm(r.get('resp')):
            continue
        homonimos = [e for e in store.get('efectivos', []) if ' '.join(norm(e.get('nombre')).split()[:2]) == clave]
        if len(homonimos) > 1:
            coincidentes = [e for e in homonimos if norm(e.get('nombre')) in norm(r.get('resp'))]
            if ef['id'] not in {e['id'] for e in coincidentes}:
                continue
        cerrada = r.get('rem') in ('SÍ', 'DEVUELTA/ARCHIVADA')
        if cerrada and not incluir_cerradas:
            continue
        v = str(r.get('venc') or '')
        try:
            dt.date.fromisoformat(v)
            valida = bool(re.fullmatch(r'\d{4}-\d\d-\d\d', v))
        except ValueError:
            valida = False
        if cerrada:
            est, orden = 'Descargada' if r.get('rem') == 'SÍ' else 'Devuelta / archivada', 4
        elif not valida:
            est, orden = ('Informe periódico' if re.search('PERI[OÓ]DIC', str(r.get('plazo') or ''), re.I) else 'Sin fecha de vencimiento'), 2
        elif v < hoy:
            est, orden = 'Vencida', 0
        elif v == hoy:
            est, orden = 'Vence hoy', 1
        elif v <= aviso:
            est, orden = 'Vence pronto', 1
        else:
            est, orden = 'Vigente', 3
        dias = (dt.date.fromisoformat(v) - dt.date.today()).days if valida else None
        res.append({'id': r['id'], 'cf': r.get('cf') or r.get('ofi') or r['id'], 'del': r.get('del') or '', 'venc': v if valida else '', 'estado': est, 'orden': orden, 'cerrada': cerrada, 'dias': dias})
    res.sort(key=lambda x: (x['orden'], x['venc'] or '9'))
    return ef, res


def corta(v):
    return v[8:10] + '/' + v[5:7] + '/' + v[:4] if re.match(r'^\d{4}-\d\d-\d\d$', v or '') else ''


def archivos_del_efectivo(efectivo_id):
    ef, carpetas = carpetas_de(efectivo_id, incluir_cerradas=True)
    if not ef:
        return {}, []
    propios = {c['id']: c['id'] for c in carpetas}
    store, _ = estado_actual()
    for original in base_pagina() + store.get('nuevos', []):
        r = {**original, **store.get('edits', {}).get(original['id'], {})}
        if r.get('adic') in propios:
            propios[r['id']] = r['adic']
    archivos = [{'clave': f[0], 'nombre': f[1], 'carpeta': propios[str(f[0]).split('|')[0]]} for f in consultar('SELECT clave, nombre FROM adjuntos') if str(f[0]).split('|')[0] in propios]
    return propios, archivos


def pagina_efectivo(base, ef, carpetas, cuenta=False):
    """base: '/e/<código>' (enlace personal) o '/mis' (usuario y contraseña)."""
    e = html.escape
    _, archivos = archivos_del_efectivo(ef['id'])
    pendientes = [c for c in carpetas if not c['cerrada']]
    vencidas = sum(c['estado'] == 'Vencida' for c in pendientes)
    hoy = sum(c['estado'] == 'Vence hoy' for c in pendientes)
    pronto = sum(c['estado'] == 'Vence pronto' for c in pendientes)
    alertas = '<strong>Recordatorios</strong><p>Vencidas: %d · Vencen hoy: %d · Vencen pronto: %d</p><span class="m">Revisión al %s. Enviar un archivo no confirma el descargo: Mesa de Partes debe revisarlo.</span>' % (vencidas, hoy, pronto, corta(dt.date.today().isoformat()))
    filas = []
    for c in pendientes:
        docs = [a for a in archivos if a['carpeta'] == c['id']]
        enlaces = ''.join('<li><a href="%s/archivo?k=%s" target="_blank" rel="noopener">Ver / descargar: %s</a></li>' % (e(base), urllib.parse.quote(a['clave'], safe=''), e(a['nombre'] or 'Documento')) for a in docs)
        dias = c['dias']
        plazo = (' · vencida hace %d día(s)' % -dias if dias is not None and dias < 0 else ' · vence hoy' if dias == 0 else ' · faltan %d día(s)' % dias if dias is not None else '') if not c['cerrada'] else ''
        filas.append('<article class="carpeta"><h3>%s</h3><span class="t %s">%s</span><p class="m">%s%s%s</p><details><summary>Documentos (%d)</summary><ul>%s</ul></details>%s</article>' % (e(c['cf']), 'r' if c['estado'] == 'Vencida' else 'a' if c['orden'] == 1 else '', e(c['estado']), e(c['del']), ' · vence '+corta(c['venc']) if c['venc'] else '', e(plazo), len(docs), enlaces or '<li>No hay archivos guardados para esta carpeta.</li>', '<button type="button" data-elegir="%s">Enviar archivo de esta carpeta</button>' % e(c['id']) if not c['cerrada'] else ''))
    opciones = ''.join('<option value="%s">%s (%s)</option>' % (e(c['id']), e(c['cf']), e(c['estado'])) for c in pendientes)
    enviados = []
    cf = {c['id']: c['cf'] for c in carpetas}
    for f in consultar('SELECT carpeta, tipo, nombre, fecha, estado FROM envios WHERE efectivo=? ORDER BY id DESC LIMIT 50', (ef['id'],)):
        enviados.append('<li><b>%s</b> · %s<br><span class="m">%s · %s · %s</span></li>' % (e(cf.get(f[0], 'Carpeta registrada en envío anterior')), e(ESTADOS_ENVIO.get(f[4], f[4])), e(TIPOS_ENVIO.get(f[1], f[1])), e(f[2]), e(f[3][:16].replace('T', ' '))))
    plantilla = (Path(__file__).parent / 'portal_efectivo.html').read_text(encoding='utf-8')
    valores = {'IDENTIDAD': e((ef.get('grado', '')+' '+ef.get('nombre', '')).strip()), 'RECORDATORIOS': alertas, 'CARPETAS': ''.join(filas) or '<p>No tienes carpetas pendientes.</p>', 'OPCIONES': opciones, 'TIPOS': ''.join('<option value="%s">%s</option>' % (k,e(TIPOS_ENVIO[k])) for k in TIPOS_PORTAL), 'ENVIADOS': ''.join(enviados) or '<li>Todavía no enviaste documentos.</li>', 'DESHABILITADO': '' if pendientes else 'disabled', 'MAXIMO': str(MAX_ARCHIVO)}
    for k,v in valores.items():
        plantilla = plantilla.replace('__'+k+'__', v)
    if cuenta:
        plantilla = plantilla.replace('Este enlace es personal. Conserva su acceso para ti.', 'Tu usuario y contraseña son personales. <a href="/mis/clave">Cambiar contraseña</a> · <a href="/mis/salir">Salir</a>', 1)
    return plantilla


# --- Cuentas de efectivos: usuario (CIP) y contraseña, como en Moral y Disciplina ---
sesiones_personal = {}  # código de sesión -> (efectivo, vence)
LETRAS_CLAVE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
INTENTOS_MAX, BLOQUEO_MIN, SESION_H = 5, 15, 8


def clave_temporal():
    return ''.join(secrets.choice(LETRAS_CLAVE) for _ in range(10))


def usuario_de(ef):
    return re.sub(r'\D', '', str(ef.get('cip') or ''))


def dni_de(ef):
    d = re.sub(r'\D', '', str(ef.get('dni') or ''))
    return d if len(d) == 8 else ''


def crear_cuenta(ef_id, store=None):
    """Crea o reinicia la cuenta: usuario = CIP; contraseña inicial = DNI (decisión del usuario),
    o una temporal si falta el DNI. En ambos casos se cambia obligatoriamente al primer ingreso."""
    if store is None:
        store, _ = estado_actual()
    ef = next((x for x in (store or {}).get('efectivos', []) if x.get('id') == ef_id), None)
    if not ef:
        raise ValueError('Ese efectivo no existe.')
    usuario = usuario_de(ef)
    if len(usuario) < 6:
        raise ValueError('Falta el CIP de este efectivo en Efectivos: es su usuario.')
    otro = consultar('SELECT efectivo FROM cuentas WHERE usuario=? AND efectivo<>?', (usuario, ef_id), uno=True)
    if otro:
        raise ValueError('Ese CIP ya es el usuario de otro efectivo. Revisa los CIP en Efectivos.')
    clave = dni_de(ef) or clave_temporal()
    sal = secrets.token_hex(16)
    with candado, bd:
        bd.execute('INSERT OR REPLACE INTO cuentas(efectivo, usuario, sal, hash, cambiar, fallos, bloqueo, fecha) VALUES (?,?,?,?,1,0,0,?)',
                   (ef_id, usuario, sal, hash_clave(clave, sal), ahora()))
        bd.commit()
        programar_respaldo()
    cerrar_sesiones(ef_id)
    return usuario, clave


def cerrar_sesiones(ef_id):
    for k, (ef, _) in list(sesiones_personal.items()):
        if ef == ef_id:
            sesiones_personal.pop(k, None)


def pagina_simple(titulo, cuerpo):
    return ('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>%s</title>'
            '<style>body{font:16px Arial,sans-serif;max-width:380px;margin:48px auto;padding:0 16px;background:#eef1f4;color:#16222c}h1{font-size:1.3rem}.m{color:#5c6b78;font-size:.9rem}'
            'label{display:block;margin-top:12px;font-size:.9rem;color:#5c6b78}input,button{width:100%%;min-height:48px;padding:10px 12px;margin-top:6px;font:inherit;box-sizing:border-box;border-radius:8px;border:1px solid #d8dee4;background:#fff;color:inherit}'
            'button{margin-top:16px;background:#1a8a4a;border:0;color:#fff;font-weight:700}.error{color:#c0342c;font-weight:600}a{color:#1a8a4a}'
            '@media (prefers-color-scheme:dark){body{background:#0f1720;color:#e7edf3}input{background:#16212c;border-color:#2a3947}button{background:#1f9d55}.m,label{color:#93a3b3}a{color:#3fbf73}}</style></head>'
            '<body><p class="m">CF · Mesa de Partes · Comisaría PNP de Ventanilla</p>%s</body></html>') % (html.escape(titulo), cuerpo)


# --- Acceso ---
sesiones = {}


TAILSCALE = ipaddress.ip_network('100.64.0.0/10')


def ips_propias():
    ips = {'127.0.0.1', 'localhost', socket.gethostname().lower()}
    try:
        ips |= {a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None) if ':' not in a[4][0]}
    except OSError:
        pass
    if A.ip_remota:
        ips.add(A.ip_remota)
    return ips


def ips_tailscale():
    if A.ip_remota:
        return [A.ip_remota]
    return sorted(ip for ip in ips_propias() if re.fullmatch(r'[\d.]+', ip) and ipaddress.ip_address(ip) in TAILSCALE)


def direcciones(puerto):
    res = ['http://127.0.0.1:%d/' % puerto]
    if leer_config().get('tailscale'):
        res += ['http://%s:%d/' % (ip, puerto) for ip in ips_tailscale()]
    if leer_config().get('red_local'):
        for ip in sorted(ips_propias()):
            try:
                a = ipaddress.ip_address(ip)
            except ValueError:
                continue
            if not a.is_loopback and not a.is_link_local:
                res.append('http://%s:%d/' % (ip, puerto))
    return res


class Manejador(http.server.BaseHTTPRequestHandler):
    server_version = 'Carpetas'
    sys_version = ''
    timeout = 30

    def log_message(self, *a):
        pass

    # Respuestas
    def responder(self, codigo, cuerpo=b'', tipo='text/plain; charset=utf-8', extra=None):
        if isinstance(cuerpo, str):
            cuerpo = cuerpo.encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(cuerpo)

    def json(self, obj, codigo=200):
        self.responder(codigo, json.dumps(obj, ensure_ascii=False), 'application/json; charset=utf-8')

    def descargar_base(self):
        destino = DATOS / ('.descarga_' + secrets.token_hex(12) + '.db')
        try:
            copiar_base(destino)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(destino.stat().st_size))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Disposition', 'attachment; filename="base_carpetas_' + dt.datetime.now().strftime('%Y%m%d_%H%M%S') + '.db"')
            self.end_headers()
            if self.command != 'HEAD':
                with destino.open('rb') as f:
                    shutil.copyfileobj(f, self.wfile, 1024 * 1024)
        finally:
            destino.unlink(missing_ok=True)

    def leer(self, maximo):
        n = int(self.headers.get('Content-Length') or 0)
        if n < 0:
            raise ValueError('Longitud no válida')
        if n > maximo:
            raise OverflowError('grande')
        datos = self.rfile.read(n)
        if len(datos) != n:
            raise ValueError('Carga incompleta')
        return datos

    # Permisos
    def local(self):
        return not A.probar_remoto and ipaddress.ip_address(self.client_address[0]).is_loopback

    def host_valido(self):
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0].strip('[]').lower()
        # El nombre que Tailscale da a esta PC (…ts.net) solo existe dentro de su red privada.
        return host in ips_propias() or host.endswith('.ts.net')

    def admin(self):
        if self.local():
            return True
        c = re.search(r'sesion=([\w-]+)', self.headers.get('Cookie') or '')
        return bool(c and sesiones.get(c.group(1), 0) > dt.datetime.now().timestamp())

    def escritura_valida(self):
        # Una cabecera propia obliga al navegador a pedir permiso entre sitios, y aquí nunca se concede.
        return self.headers.get('X-Carpetas') == '1'

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionError, TimeoutError):
            pass

    def entrada(self):
        if not self.host_valido():
            self.responder(400, 'Dirección no válida.')
            return None
        u = urllib.parse.urlsplit(self.path)
        return u.path, urllib.parse.parse_qs(u.query)

    # GET
    def do_GET(self):
        e = self.entrada()
        if not e:
            return
        ruta, q = e
        m = re.fullmatch(r'/e/([\w-]{20,60})/?', ruta)
        if m:
            return self.portal(m.group(1))
        m = re.fullmatch(r'/e/([\w-]{20,60})/archivo', ruta)
        if m:
            return self.archivo_personal(m.group(1), q.get('k', [''])[0])
        # Efectivos con usuario y contraseña. Nunca pasan por los permisos del administrador.
        if ruta == '/ingresar':
            return self.form_ingresar()
        if ruta in ('/mis', '/mis/', '/mis/archivo', '/mis/clave', '/mis/salir'):
            return self.mis(ruta, q)
        if ruta == '/entrar':
            return self.form_entrar()
        if not self.admin():
            return self.responder(303, '', extra={'Location': '/entrar'})
        if ruta == '/api/respaldo':
            if q.get('formato') == ['json']:
                with candado:
                    store, _ = estado_actual()
                    store = store or {'edits': {}, 'nuevos': [], 'cfg': {'aviso': 7}, 'efectivos': []}
                    archivos = [{'clave': f[0], 'nombre': f[1], 'tipo': f[2], 'datos': base64.b64encode(f[3]).decode('ascii')} for f in bd.execute('SELECT clave, nombre, tipo, datos FROM adjuntos')]
                    contenido = json.dumps({**store, 'adjuntos': archivos}, ensure_ascii=False)
                return self.responder(200, contenido, 'application/json; charset=utf-8', {'Content-Disposition': 'attachment; filename="respaldo_completo_carpetas_ventanilla_' + dt.date.today().isoformat() + '.json"'})
            return self.descargar_base()
        if ruta in ('/', '/index.html'):
            store, version = estado_actual()
            datos = json.dumps({'version': version, 'store': store}, ensure_ascii=False).replace('</', '<\\/')
            t = HTML_PAGINA.read_text(encoding='utf-8').replace(MARCA, '<script type="application/json" id="servidor">' + datos + '</script>', 1)
            return self.responder(200, t, 'text/html; charset=utf-8')
        m = re.fullmatch(r'/recursos/([\w.-]+\.js)', ruta)
        if m and (PAGINA / 'recursos' / m.group(1)).is_file():
            return self.responder(200, (PAGINA / 'recursos' / m.group(1)).read_bytes(), 'text/javascript; charset=utf-8')
        if ruta == '/api/estado':
            store, version = estado_actual()
            return self.json({'version': version, 'store': store})
        if ruta == '/api/adjunto':
            f = consultar('SELECT nombre, tipo, datos FROM adjuntos WHERE clave=?', (q.get('k', [''])[0],), uno=True)
            if not f:
                return self.responder(404, 'No existe.')
            tipo = f[1] if f[1] in MIME_DOCUMENTOS else 'application/octet-stream'
            return self.responder(200, f[2], tipo, {'X-Nombre': urllib.parse.quote(f[0] or ''), 'Content-Security-Policy': "sandbox; default-src 'none'"})
        if ruta == '/api/adjuntos':
            return self.json([{'clave': f[0], 'nombre': f[1], 'tipo': f[2], 'fecha': f[3]} for f in consultar('SELECT clave, nombre, tipo, fecha FROM adjuntos')])
        if ruta == '/api/envios':
            return self.json([dict(zip(('id', 'efectivo', 'carpeta', 'tipo', 'nota', 'nombre', 'mime', 'tam', 'fecha', 'estado', 'revisado'), f))
                              for f in consultar('SELECT id, efectivo, carpeta, tipo, nota, nombre, mime, tam, fecha, estado, revisado FROM envios ORDER BY id DESC')])
        if ruta == '/api/envio':
            f = consultar('SELECT nombre, mime, datos FROM envios WHERE id=?', (q.get('id', ['0'])[0],), uno=True)
            if not f:
                return self.responder(404, 'No existe.')
            tipo = f[1] if f[1] in MIME_DOCUMENTOS else 'application/octet-stream'
            disp = 'attachment' if q.get('bajar') or tipo == 'application/octet-stream' else 'inline'
            return self.responder(200, f[2], tipo, {'Content-Disposition': "%s; filename*=UTF-8''%s" % (disp, urllib.parse.quote(f[0])), 'Content-Security-Policy': "sandbox; default-src 'none'"})
        if ruta == '/api/enlaces':
            return self.json({f[0]: f[1] for f in consultar('SELECT efectivo, token FROM enlaces')})
        if ruta == '/api/cuentas':
            return self.json({f[0]: {'usuario': f[1], 'cambiar': bool(f[2]), 'bloqueada': f[3] > dt.datetime.now().timestamp(), 'fecha': f[4]}
                              for f in consultar('SELECT efectivo, usuario, cambiar, bloqueo, fecha FROM cuentas')})
        if ruta == '/api/info':
            with candado:
                version = estado_actual()[1]
                conteos = {tabla: bd.execute('SELECT COUNT(*) FROM ' + tabla).fetchone()[0] for tabla in ('adjuntos', 'envios')}
                respaldo = dict(estado_respaldo)
            return self.json({'publicacion': publicacion_personal(), 'direcciones': direcciones(self.server.server_address[1]), 'red_local': bool(leer_config().get('red_local') or leer_config().get('tailscale')), 'tailscale': bool(leer_config().get('tailscale')), 'clave': bool(leer_config().get('clave')), 'version_servidor': VERSION_SERVIDOR, 'restauracion_atomica': True, 'max_restauracion': MAX_RESTAURACION, 'respaldo': respaldo, 'conteos': conteos, 'version_datos': version})
        self.responder(404, 'No existe.')

    do_HEAD = do_GET

    # PUT / POST / DELETE
    def do_PUT(self):
        e = self.entrada()
        if not e:
            return
        ruta, q = e
        if not (self.admin() and self.escritura_valida()):
            return self.responder(403, 'Sin permiso.')
        try:
            if ruta == '/api/estado':
                cuerpo = json.loads(self.leer(MAX_ESTADO))
                if not isinstance(cuerpo, dict) or not validar_estado(cuerpo.get('store')):
                    return self.responder(400, 'Formato.')
                version = cuerpo.get('version')
                if type(version) is not int or version < 0:
                    return self.responder(400, 'Versión no válida.')
                ok, version = guardar_estado(cuerpo['store'], version)
                return self.json({'version': version}, 200 if ok else 409)
            if ruta == '/api/adjunto':
                clave = q.get('k', [''])[0]
                if not clave or len(clave) > 200:
                    return self.responder(400, 'Falta la clave del documento.')
                datos = self.leer(MAX_ARCHIVO)
                if not datos:
                    return self.responder(400, 'El archivo está vacío.')
                with candado, bd:
                    bd.execute('INSERT OR REPLACE INTO adjuntos VALUES (?,?,?,?,?)', (clave, q.get('n', [''])[0][:200], q.get('t', [''])[0][:100], datos, ahora()))
                    bd.commit()
                    programar_respaldo()
                return self.json({'ok': True})
        except OverflowError:
            return self.responder(413, 'El archivo es demasiado grande.')
        except (ValueError, TypeError):
            return self.responder(400, 'Datos no válidos. No se guardaron cambios.')
        self.responder(404, 'No existe.')

    def do_DELETE(self):
        e = self.entrada()
        if not e:
            return
        ruta, q = e
        if not (self.admin() and self.escritura_valida()):
            return self.responder(403, 'Sin permiso.')
        if ruta == '/api/adjunto':
            with candado, bd:
                bd.execute('DELETE FROM adjuntos WHERE clave=?', (q.get('k', [''])[0],))
                bd.commit()
                programar_respaldo()
            return self.json({'ok': True})
        self.responder(404, 'No existe.')

    def do_POST(self):
        e = self.entrada()
        if not e:
            return
        ruta, q = e
        m = re.fullmatch(r'/e/([\w-]{20,60})/enviar', ruta)
        if m:
            return self.recibir(m.group(1))
        if ruta == '/ingresar':
            return self.ingresar()
        if ruta in ('/mis/enviar', '/mis/clave'):
            return self.mis_post(ruta)
        if ruta == '/entrar':
            return self.entrar()
        if not (self.admin() and self.escritura_valida()):
            return self.responder(403, 'Sin permiso.')
        if ruta == '/api/restaurar':
            try:
                cuerpo = json.loads(self.leer(MAX_RESTAURACION))
                archivos = preparar_restauracion(cuerpo)
                ok, version = restaurar_estado(cuerpo, archivos)
                return self.json({'version': version}, 200 if ok else 409)
            except OverflowError:
                return self.responder(413, 'El respaldo supera los 128 MB.')
            except (ValueError, TypeError):
                return self.responder(400, 'El respaldo contiene datos o documentos no válidos. No se cambió nada.')
            except (OSError, sqlite3.Error):
                return self.responder(503, 'No se pudo completar la restauración. Se conservaron los datos anteriores.')
        try:
            cuerpo = json.loads(self.leer(100_000) or b'{}')
            if not isinstance(cuerpo, dict):
                raise ValueError('Formato')
        except (ValueError, OverflowError):
            return self.responder(400, 'Formato.')
        if ruta == '/api/enlace':
            ef = str(cuerpo.get('efectivo') or '')
            store, _ = estado_actual()
            if not store or not any(x.get('id') == ef for x in store.get('efectivos', [])):
                return self.responder(400, 'Ese efectivo no existe.')
            with candado, bd:
                f = bd.execute('SELECT token FROM enlaces WHERE efectivo=?', (ef,)).fetchone()
                if f and not cuerpo.get('nuevo'):
                    token = f[0]
                else:
                    token = secrets.token_urlsafe(24)
                    bd.execute('INSERT OR REPLACE INTO enlaces VALUES (?,?,?)', (ef, token, ahora()))
                    bd.commit()
                    programar_respaldo()
            return self.json({'token': token, 'direcciones': direcciones(self.server.server_address[1]), 'publicacion': publicacion_personal()})
        if ruta == '/api/cuentas/todas':
            # Crea las que faltan para los efectivos activos (usuario CIP, contraseña inicial DNI). No reinicia las existentes.
            store, _ = estado_actual()
            existentes = {f[0] for f in consultar('SELECT efectivo FROM cuentas')}
            creadas, faltan = [], []
            for ef in (store or {}).get('efectivos', []):
                if not ef.get('activo') or ef.get('id') in existentes:
                    continue
                nombre = (ef.get('grado', '') + ' ' + ef.get('nombre', '')).strip()
                if not dni_de(ef):
                    faltan.append(nombre + ': falta DNI')
                    continue
                try:
                    usuario, _ = crear_cuenta(ef['id'], store)
                    creadas.append({'efectivo': ef['id'], 'nombre': nombre, 'usuario': usuario})
                except ValueError as error:
                    faltan.append(nombre + ': ' + str(error))
            return self.json({'creadas': creadas, 'faltan': faltan, 'direcciones': direcciones(self.server.server_address[1]), 'publicacion': publicacion_personal()})
        if ruta == '/api/cuenta':
            ef = str(cuerpo.get('efectivo') or '')
            if cuerpo.get('quitar'):
                with candado, bd:
                    bd.execute('DELETE FROM cuentas WHERE efectivo=?', (ef,))
                    bd.commit()
                    programar_respaldo()
                cerrar_sesiones(ef)
                return self.json({'ok': True})
            try:
                usuario, clave = crear_cuenta(ef)
            except ValueError as error:
                return self.responder(400, str(error))
            return self.json({'usuario': usuario, 'clave': clave, 'direcciones': direcciones(self.server.server_address[1]), 'publicacion': publicacion_personal()})
        if ruta == '/api/envio/estado':
            if cuerpo.get('estado') not in ESTADOS_ENVIO:
                return self.responder(400, 'Estado.')
            if type(cuerpo.get('id')) is not int or cuerpo['id'] < 1:
                return self.responder(400, 'Identificador no válido.')
            with candado, bd:
                cambio = bd.execute('UPDATE envios SET estado=?, revisado=? WHERE id=?', (cuerpo['estado'], ahora(), cuerpo['id']))
                bd.commit()
                programar_respaldo()
            if not cambio.rowcount:
                return self.responder(404, 'No existe ese envío.')
            return self.json({'ok': True})
        self.responder(404, 'No existe.')

    # Portal del efectivo
    def efectivo_de_token(self, token):
        f = consultar('SELECT efectivo FROM enlaces WHERE token=?', (token,), uno=True)
        return f[0] if f else None

    def portal(self, token):
        return self.mostrar_portal(self.efectivo_de_token(token), '/e/' + token)

    def mostrar_portal(self, ef_id, base, cuenta=False):
        ef, carpetas = carpetas_de(ef_id, incluir_cerradas=True) if ef_id else (None, [])
        if not ef:
            return self.responder(404, 'Este enlace no es válido. Pide uno nuevo a Mesa de Partes.')
        self.responder(200, pagina_efectivo(base, ef, carpetas, cuenta), 'text/html; charset=utf-8', {'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'"})

    def archivo_personal(self, token, clave):
        return self.archivo_de(self.efectivo_de_token(token), clave)

    def archivo_de(self, ef_id, clave):
        if not ef_id:
            return self.responder(404, 'Este enlace no es válido.')
        propios, _ = archivos_del_efectivo(ef_id)
        if str(clave).split('|')[0] not in propios:
            return self.responder(403, 'Este documento no pertenece a tus carpetas.')
        archivo = consultar('SELECT nombre,tipo,datos FROM adjuntos WHERE clave=?', (clave,), uno=True)
        if not archivo:
            return self.responder(404, 'No se encontró el archivo.')
        tipo = archivo[1] if archivo[1] in MIME_DOCUMENTOS else 'application/octet-stream'
        disposicion = 'inline' if tipo != 'application/octet-stream' else 'attachment'
        return self.responder(200, archivo[2], tipo, {'Content-Disposition': "%s; filename*=UTF-8''%s" % (disposicion, urllib.parse.quote(archivo[0] or 'documento')), 'Content-Security-Policy': "sandbox; default-src 'none'"})

    def recibir(self, token):
        return self.recibir_de(self.efectivo_de_token(token))

    # --- Usuario y contraseña del efectivo ---
    def sesion_personal(self):
        c = re.search(r'(?:^|;\s*)personal=([\w-]{20,80})', self.headers.get('Cookie') or '')
        if not c:
            return None
        ef_id, vence = sesiones_personal.get(c.group(1), (None, 0))
        if vence <= dt.datetime.now().timestamp():
            sesiones_personal.pop(c.group(1), None)
            return None
        cuenta = consultar('SELECT cambiar FROM cuentas WHERE efectivo=?', (ef_id,), uno=True)
        if not cuenta:  # la cuenta se quitó: la sesión deja de valer
            sesiones_personal.pop(c.group(1), None)
            return None
        return ef_id, bool(cuenta[0]), c.group(1)

    def ir(self, destino, cookie=None):
        self.responder(303, '', extra={'Location': destino, **({'Set-Cookie': cookie} if cookie else {})})

    def form_ingresar(self, error='', usuario=''):
        self.responder(200, pagina_simple('Mis carpetas', '<h1>Mis carpetas fiscales</h1><p class="m">Ingresa con tu CIP y tu contraseña.</p>' +
                       ('<p class="error">%s</p>' % html.escape(error) if error else '') +
                       '<form method="post" action="/ingresar"><label for="u">Usuario (CIP)</label><input id="u" name="usuario" inputmode="numeric" autocomplete="username" required value="%s">'
                       '<label for="c">Contraseña</label><input id="c" type="password" name="clave" autocomplete="current-password" required><button>Ingresar</button></form>'
                       '<p class="m">¿Olvidaste tu contraseña? Pide a Mesa de Partes que la reinicie.</p>' % html.escape(usuario)), 'text/html; charset=utf-8')

    def ingresar(self):
        try:
            datos = urllib.parse.parse_qs(self.leer(4000).decode('utf-8'))
        except (ValueError, OverflowError, UnicodeDecodeError):
            datos = {}
        usuario = re.sub(r'\D', '', datos.get('usuario', [''])[0])[:20]
        clave = datos.get('clave', [''])[0][:200]
        f = consultar('SELECT efectivo, sal, hash, fallos, bloqueo FROM cuentas WHERE usuario=?', (usuario,), uno=True) if usuario else None
        ahora_ts = dt.datetime.now().timestamp()
        if f and f[4] > ahora_ts:
            return self.form_ingresar('Cuenta bloqueada por varios intentos fallidos. Espera %d minutos o pide a Mesa de Partes que reinicie tu contraseña.' % math.ceil((f[4] - ahora_ts) / 60), usuario)
        if not f or not hmac.compare_digest(hash_clave(clave, f[1]), f[2]):
            if f:
                fallos = f[3] + 1
                with candado, bd:
                    bd.execute('UPDATE cuentas SET fallos=?, bloqueo=? WHERE efectivo=?', (0 if fallos >= INTENTOS_MAX else fallos, ahora_ts + BLOQUEO_MIN * 60 if fallos >= INTENTOS_MAX else 0, f[0]))
                    bd.commit()
            threading.Event().wait(1)  # frena los intentos repetidos
            return self.form_ingresar('Usuario o contraseña incorrectos.', usuario)
        with candado, bd:
            bd.execute('UPDATE cuentas SET fallos=0, bloqueo=0 WHERE efectivo=?', (f[0],))
            bd.commit()
        codigo = secrets.token_urlsafe(32)
        sesiones_personal[codigo] = (f[0], ahora_ts + SESION_H * 3600)
        self.ir('/mis', 'personal=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=%d' % (codigo, SESION_H * 3600))

    def mis(self, ruta, q):
        s = self.sesion_personal()
        if not s:
            return self.ir('/ingresar')
        ef_id, cambiar, codigo = s
        if ruta == '/mis/salir':
            sesiones_personal.pop(codigo, None)
            return self.ir('/ingresar', 'personal=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        if ruta == '/mis/clave' or cambiar:
            return self.form_clave(cambiar)
        if ruta == '/mis/archivo':
            return self.archivo_de(ef_id, q.get('k', [''])[0])
        return self.mostrar_portal(ef_id, '/mis', True)

    def form_clave(self, obligatorio, error=''):
        self.responder(200, pagina_simple('Cambiar contraseña', '<h1>Cambiar contraseña</h1>' +
                       ('<p class="m">Es tu primer ingreso o te reiniciaron la contraseña: crea una propia para continuar. Tu contraseña actual es tu DNI.</p>' if obligatorio else '<p class="m"><a href="/mis">← Volver a mis carpetas</a></p>') +
                       ('<p class="error">%s</p>' % html.escape(error) if error else '') +
                       '<form method="post" action="/mis/clave"><label for="a">Contraseña actual</label><input id="a" type="password" name="actual" autocomplete="current-password" required>'
                       '<label for="n">Contraseña nueva (mínimo 8, con letras y números)</label><input id="n" type="password" name="nueva" autocomplete="new-password" minlength="8" required>'
                       '<label for="r">Repite la contraseña nueva</label><input id="r" type="password" name="repite" autocomplete="new-password" minlength="8" required><button>Guardar contraseña</button></form>'),
                       'text/html; charset=utf-8')

    def mis_post(self, ruta):
        s = self.sesion_personal()
        if not s:
            return self.responder(401, 'Tu sesión terminó. Vuelve a ingresar.') if ruta == '/mis/enviar' else self.ir('/ingresar')
        ef_id, cambiar, codigo = s
        if ruta == '/mis/enviar':
            if cambiar:
                return self.responder(403, 'Primero cambia tu contraseña.')
            return self.recibir_de(ef_id)
        try:
            datos = urllib.parse.parse_qs(self.leer(4000).decode('utf-8'))
        except (ValueError, OverflowError, UnicodeDecodeError):
            datos = {}
        actual, nueva, repite = (datos.get(k, [''])[0][:200] for k in ('actual', 'nueva', 'repite'))
        f = consultar('SELECT sal, hash, usuario FROM cuentas WHERE efectivo=?', (ef_id,), uno=True)
        if not f or not hmac.compare_digest(hash_clave(actual, f[0]), f[1]):
            threading.Event().wait(1)
            return self.form_clave(cambiar, 'La contraseña actual no es correcta.')
        if nueva != repite:
            return self.form_clave(cambiar, 'Las contraseñas nuevas no coinciden.')
        store, _ = estado_actual()
        dni = dni_de(next((x for x in (store or {}).get('efectivos', []) if x.get('id') == ef_id), {}))
        if len(nueva) < 8 or not re.search(r'[A-Za-z]', nueva) or not re.search(r'\d', nueva) or nueva == actual or f[2] in nueva or (dni and dni in nueva):
            return self.form_clave(cambiar, 'Usa al menos 8 caracteres con letras y números, distinta de la anterior y sin tu CIP ni tu DNI.')
        sal = secrets.token_hex(16)
        with candado, bd:
            bd.execute('UPDATE cuentas SET sal=?, hash=?, cambiar=0, fecha=? WHERE efectivo=?', (sal, hash_clave(nueva, sal), ahora(), ef_id))
            bd.commit()
            programar_respaldo()
        # Las demás sesiones abiertas con la contraseña anterior se cierran.
        for k, (ef, _) in list(sesiones_personal.items()):
            if ef == ef_id and k != codigo:
                sesiones_personal.pop(k, None)
        self.ir('/mis')

    def recibir_de(self, ef_id):
        ef, carpetas = carpetas_de(ef_id) if ef_id else (None, [])
        if not ef:
            return self.responder(404, 'Este enlace no es válido.')
        carpeta = self.headers.get('X-Carpeta') or ''
        tipo = self.headers.get('X-Tipo') or ''
        mime = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if carpeta not in {c['id'] for c in carpetas}:
            return self.responder(400, 'Esa carpeta no está entre tus pendientes.')
        if tipo not in TIPOS_PORTAL:
            return self.responder(400, 'Tipo de documento no válido.')
        if mime not in MIME_DOCUMENTOS:
            return self.responder(400, 'Solo se aceptan PDF o fotos.')
        try:
            datos = self.leer(MAX_ARCHIVO)
        except OverflowError:
            return self.responder(413, 'El archivo pesa más de 25 MB.')
        except ValueError:
            return self.responder(400, 'Carga no válida.')
        if not datos:
            return self.responder(400, 'El archivo está vacío.')
        nombre = re.sub(r'[\\/:*?"<>|\r\n]+', '_', urllib.parse.unquote(self.headers.get('X-Nombre') or 'documento'))[:120]
        nota = urllib.parse.unquote(self.headers.get('X-Nota') or '')[:500]
        with candado, bd:
            bd.execute('INSERT INTO envios(efectivo, carpeta, tipo, nota, nombre, mime, datos, tam, fecha) VALUES (?,?,?,?,?,?,?,?,?)',
                       (ef_id, carpeta, tipo, nota, nombre, mime, datos, len(datos), ahora()))
            bd.commit()
            programar_respaldo()
        self.responder(200, 'Enviado.')

    # Entrada del administrador desde otro equipo
    def form_entrar(self, error=''):
        cfg = leer_config()
        aviso = '' if cfg.get('clave') else '<p>Aún no hay contraseña. En esta PC, ejecuta CAMBIAR CONTRASENA.bat.</p>'
        self.responder(200, '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar</title>'
                       '<style>body{font:16px Arial,sans-serif;max-width:360px;margin:60px auto;padding:0 16px;background:#eef1f4;color:#16222c}'
                       'input,button{width:100%;min-height:48px;padding:10px 12px;margin-top:10px;font:inherit;box-sizing:border-box;border-radius:8px;border:1px solid #d8dee4;background:#fff;color:inherit}'
                       'button{background:#1a8a4a;border:0;color:#fff;font-weight:700}'
                       '@media (prefers-color-scheme:dark){body{background:#0f1720;color:#e7edf3}input{background:#16212c;border-color:#2a3947}button{background:#1f9d55}}</style></head><body>'
                       '<h1>Carpetas Fiscales</h1>' + aviso + ('<p style="color:#c0342c">' + html.escape(error) + '</p>' if error else '') +
                       '<form method="post" action="/entrar"><input type="password" name="clave" placeholder="Contraseña" autofocus required><button>Entrar</button></form></body></html>',
                       'text/html; charset=utf-8')

    def entrar(self):
        cfg = leer_config()
        try:
            clave = urllib.parse.parse_qs(self.leer(2000).decode('utf-8')).get('clave', [''])[0]
        except (ValueError, OverflowError):
            clave = ''
        c = cfg.get('clave')
        if not c or not hmac.compare_digest(hash_clave(clave, c['sal']), c['hash']):
            threading.Event().wait(1)  # frena los intentos repetidos
            return self.form_entrar('Contraseña incorrecta.')
        token = secrets.token_urlsafe(32)
        sesiones[token] = dt.datetime.now().timestamp() + 12 * 3600
        self.responder(303, '', extra={'Location': '/', 'Set-Cookie': 'sesion=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' % token})


class Servidor(http.server.ThreadingHTTPServer):
    # Sin buscar el nombre de la dirección en la red: en Windows eso puede tardar muchos segundos.
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def escuchar_tailscale():
    # Tailscale puede conectarse después que la base de datos: se reintenta hasta tener su dirección.
    abiertas, avisadas = set(), set()
    while True:
        for ip in ips_tailscale():
            if ip in abiertas:
                continue
            try:
                s = Servidor((ip, A.puerto), Manejador)
            except OSError as e:
                if ip not in avisadas:
                    print('Aún no se puede escuchar en', ip, '-', e, flush=True)
                    avisadas.add(ip)
                continue
            s.daemon_threads = True
            threading.Thread(target=s.serve_forever, daemon=True).start()
            abiertas.add(ip)
            print('Escuchando por Tailscale en', ip, flush=True)
        threading.Event().wait(30)


def main():
    cfg = leer_config()
    programar_respaldo()
    threading.Thread(target=mantener_respaldos, daemon=True).start()
    direccion = '0.0.0.0' if cfg.get('red_local') else '127.0.0.1'
    try:
        srv = Servidor((direccion, A.puerto), Manejador)
    except OSError:
        sys.exit('El puerto %d ya está en uso: el servidor probablemente ya está abierto.' % A.puerto)
    srv.daemon_threads = True
    if cfg.get('tailscale') and not cfg.get('red_local'):
        threading.Thread(target=escuchar_tailscale, daemon=True).start()
    print('Base de datos en', DB_RUTA, '| direcciones:', ', '.join(direcciones(A.puerto)), flush=True)
    srv.serve_forever()


main()
