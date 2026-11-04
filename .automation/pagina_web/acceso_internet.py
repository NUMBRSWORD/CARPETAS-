"""Entrada exclusiva del portal personal para colocar detrás de HTTPS/Cloudflare.

Nunca publicar directamente el puerto del administrador (8765). Este proceso no
abre la base: filtra rutas y comunica solo el portal con el servidor local.
"""
import argparse
from collections import OrderedDict, deque
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import re
import threading
import time
from urllib.parse import urlsplit

MAX_ARCHIVO = 25 * 1024 * 1024
MAX_RESPUESTA = MAX_ARCHIVO + 1024 * 1024
TOKEN = r'[A-Za-z0-9_-]{20,60}'


def ruta_permitida(metodo, destino):
    if len(destino) > 2000 or '#' in destino:
        return False
    u = urlsplit(destino)
    if u.scheme or u.netloc:
        return False
    if metodo in ('GET', 'HEAD'):
        return bool(re.fullmatch('/e/' + TOKEN + r'/?', u.path) or
                    re.fullmatch('/e/' + TOKEN + '/archivo', u.path) or
                    u.path in ('/ingresar', '/mis', '/mis/', '/mis/archivo', '/mis/clave', '/mis/salir'))
    return metodo == 'POST' and not u.query and bool(re.fullmatch('/e/' + TOKEN + '/enviar', u.path) or u.path in ('/ingresar', '/mis/enviar', '/mis/clave'))


def cookie_personal(texto):
    """Del navegador solo pasa la cookie de sesión del efectivo; nunca la del administrador."""
    m = re.search(r'(?:^|;\s*)(personal=[\w-]{20,80})(?:;|$)', texto or '')
    return m.group(1) if m else ''


class Entrada(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, direccion, origen, dominio):
        if direccion[0] != '127.0.0.1':
            raise ValueError('La entrada solo escucha en 127.0.0.1.')
        if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', dominio):
            raise ValueError('Indica el dominio HTTPS público, sin https:// ni rutas.')
        self.origen = origen
        self.dominio = dominio
        self.turnos = threading.BoundedSemaphore(12)
        self.filtro = threading.Lock()
        self.intentos = OrderedDict()
        super().__init__(direccion, Puerta)

    def process_request(self, request, client_address):
        if not self.turnos.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.turnos.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.turnos.release()

    def permite_frecuencia(self, token, envio):
        ahora = time.monotonic()
        clave = (token, envio)
        with self.filtro:
            cola = self.intentos.setdefault(clave, deque())
            self.intentos.move_to_end(clave)
            ventana, maximo = (600, 10) if envio else (60, 120)
            while cola and cola[0] <= ahora - ventana:
                cola.popleft()
            if len(cola) >= maximo:
                return False
            cola.append(ahora)
            while len(self.intentos) > 2048:
                self.intentos.popitem(last=False)
            return True


class Puerta(BaseHTTPRequestHandler):
    server_version = 'Portal'
    sys_version = ''

    def log_message(self, formato, *args):
        # El código personal nunca se escribe en registros del proxy.
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(45)

    def responder(self, estado, datos, cabeceras=None):
        datos = datos.encode('utf-8') if isinstance(datos, str) else datos
        self.send_response(estado)
        for k, v in (cabeceras or {'Content-Type': 'text/plain; charset=utf-8'}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(datos)))
        self.send_header('Cache-Control', 'no-store, private')
        # Los enlaces llevan el código en la dirección: nunca se comparte. En usuario y contraseña, Chrome
        # necesita "same-origin" para enviar el Origin real del formulario (con "no-referrer" manda "null").
        self.send_header('Referrer-Policy', 'no-referrer' if self.path.startswith('/e/') else 'same-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Robots-Tag', 'noindex, nofollow, noarchive')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        if self.command != 'HEAD':
            self.wfile.write(datos)

    def reenviar(self):
        try:
            hosts = self.headers.get_all('Host', [])
            if len(hosts) != 1 or hosts[0].lower() != self.server.dominio:
                return self.responder(400, 'Dirección no válida.')
            if not ruta_permitida(self.command, self.path):
                return self.responder(404, 'No existe. Usa tu enlace personal.')
            origen = self.headers.get('Origin')
            if origen and origen != 'https://' + self.server.dominio:
                return self.responder(403, 'Vuelve a abrir la página de ingreso e inténtalo de nuevo.')
            if self.headers.get_all('Transfer-Encoding') or self.headers.get('Expect'):
                return self.responder(400, 'Formato no admitido.')
            longitudes = self.headers.get_all('Content-Length', [])
            if len(longitudes) > 1 or (longitudes and not re.fullmatch(r'[0-9]+', longitudes[0])):
                return self.responder(400, 'Longitud no válida.')
            largo = int(longitudes[0]) if longitudes else 0
            if largo > MAX_ARCHIVO:
                return self.responder(413, 'El archivo supera 25 MB.')
            if self.command == 'POST' and largo == 0:
                return self.responder(400, 'El archivo está vacío.')
            if self.command != 'POST' and largo:
                return self.responder(400, 'Formato no admitido.')
            # Enlaces: por código. Usuario y contraseña: por la IP real que informa Cloudflare.
            partes = urlsplit(self.path).path.split('/')
            token = partes[2] if partes[1] == 'e' else 'cuenta:' + (self.headers.get('CF-Connecting-IP') or 'sin-ip')
            if not self.server.permite_frecuencia(token, self.command == 'POST'):
                return self.responder(429, 'Demasiados intentos. Espera unos minutos.')
            datos = self.rfile.read(largo) if largo else None
            if datos is not None and len(datos) != largo:
                return self.responder(400, 'El envío no llegó completo.')
            # El origen es fijo y local. No se reenvían cookies ni cabeceras de administrador.
            cab = {k: self.headers[k] for k in ('Content-Type', 'X-Carpeta', 'X-Tipo', 'X-Nombre', 'X-Nota') if k in self.headers}
            cab['Host'] = '127.0.0.1:' + str(self.server.origen)
            sesion = cookie_personal(self.headers.get('Cookie'))
            if sesion:
                cab['Cookie'] = sesion
            c = http.client.HTTPConnection('127.0.0.1', self.server.origen, timeout=45)
            try:
                c.request(self.command, self.path, body=datos, headers=cab)
                respuesta = c.getresponse()
                cuerpo = respuesta.read(MAX_RESPUESTA + 1)
                redireccion = respuesta.status == 303 and re.fullmatch(r'/(?:ingresar|mis)', respuesta.getheader('Location') or '')
                if len(cuerpo) > MAX_RESPUESTA or not (200 <= respuesta.status < 300 or redireccion) and respuesta.status < 400:
                    return self.responder(502, 'Respuesta inesperada del servidor local.')
                cab = {k: v for k, v in respuesta.getheaders() if k.lower() in ('content-type', 'content-disposition', 'content-security-policy', 'x-nombre')}
                if redireccion:
                    cab['Location'] = respuesta.getheader('Location')
                galleta = respuesta.getheader('Set-Cookie') or ''
                if re.fullmatch(r'personal=[\w-]{0,80}; HttpOnly; SameSite=Strict; Path=/; Max-Age=\d+', galleta):
                    cab['Set-Cookie'] = galleta + '; Secure'
                cab.setdefault('Content-Type', 'application/octet-stream')
                if 'text/html' in cab.get('Content-Type', ''):
                    cab['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
                return self.responder(respuesta.status, cuerpo, cab)
            finally:
                c.close()
        except (OSError, http.client.HTTPException, ValueError):
            self.responder(503, 'No se pudo confirmar la operación. Actualiza tus envíos antes de repetir.')

    do_GET = reenviar
    do_HEAD = reenviar
    do_POST = reenviar
    do_PUT = reenviar
    do_DELETE = reenviar
    do_OPTIONS = reenviar
    do_PATCH = reenviar


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dominio', required=True)
    p.add_argument('--puerto', type=int, default=8766)
    p.add_argument('--origen', type=int, default=8765)
    a = p.parse_args()
    with Entrada(('127.0.0.1', a.puerto), a.origen, a.dominio.lower()) as servidor:
        print('Entrada personal lista en 127.0.0.1:%d. Todavía requiere el túnel HTTPS.' % a.puerto, flush=True)
        servidor.serve_forever()
