"""Mantiene un acceso HTTPS temporal al portal; nunca expone el administrador.

El túnel gratuito cambia de dirección cuando se reinicia. La base permanece local.
Este proceso debe seguir activo mientras los efectivos necesiten entrar.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

P = Path(__file__).resolve().parent
ROOT = P.parents[1]
RUNTIME = ROOT / '.automation/acceso_internet'
ESTADO = ROOT / 'datos_servidor/acceso_internet.json'


def atomico(ruta, datos):
    temporal = ruta.with_suffix(ruta.suffix + '.tmp')
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    temporal.replace(ruta)


# La pantalla pública vive aparte para conservar una dirección estable, independiente del código.
PUBLICO = ROOT / '.automation/acceso_publico'
PAGINA_PUBLICA = 'https://numbrsword.github.io/mis-carpetas/'


def publicar_github(portal):
    """Solo actualiza la dirección de conexión en el repositorio público aparte. No sube código ni datos."""
    ruta = PUBLICO / 'config.json'
    if not (PUBLICO / '.git').exists():
        raise RuntimeError('Falta el repositorio público de la página de aviso (.automation/acceso_publico).')
    if subprocess.check_output(['git', 'branch', '--show-current'], cwd=PUBLICO, text=True).strip() != 'main':
        raise RuntimeError('Git debe estar en main para actualizar la entrada pública.')
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never'}
    atomico(ruta, {'portal': portal + '/', 'disponible': True})
    distinto = subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', 'config.json'], cwd=PUBLICO).returncode
    if distinto == 1:
        subprocess.run(['git', 'add', '--', 'config.json'], cwd=PUBLICO, check=True, capture_output=True)
        subprocess.run(['git', 'commit', '--only', '-m', 'Actualizar dirección del portal personal', '--', 'config.json'], cwd=PUBLICO, check=True, capture_output=True)
    elif distinto:
        raise RuntimeError('No se pudo comprobar el archivo de conexión en Git.')
    subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=PUBLICO, env=env, check=True, capture_output=True, timeout=60)
    # El enlace directo sigue siendo útil mientras Pages despliega el cambio.
    return PAGINA_PUBLICA


def proceso_vivo(pid, nombres):
    """Nombre del proceso con ese número, solo si es uno de los esperados (Windows)."""
    try:
        salida = subprocess.run(['tasklist', '/FI', 'PID eq %d' % int(pid), '/FO', 'CSV', '/NH'], capture_output=True, text=True, timeout=15).stdout
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    m = re.match(r'"([^"]+)"', salida.strip())
    return bool(m and m.group(1).lower() in nombres)


def limpiar_interrumpido():
    """True si el inicio anterior quedó interrumpido y se pudo limpiar; False si sigue activo."""
    try:
        datos = json.loads((RUNTIME / 'procesos.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    if datos.get('supervisor') and proceso_vivo(datos['supervisor'], {'python.exe', 'pythonw.exe'}):
        return False
    for clave, nombres in (('tunel', {'cloudflared.exe'}), ('entrada', {'python.exe', 'pythonw.exe'})):
        pid = datos.get(clave)
        if pid and proceso_vivo(pid, nombres):
            subprocess.run(['taskkill', '/PID', str(int(pid)), '/T', '/F'], capture_output=True, timeout=15)
            if proceso_vivo(pid, nombres):
                raise RuntimeError('Quedó una conexión anterior que no se pudo cerrar. Ejecuta este archivo como administrador.')
    (RUNTIME / 'procesos.json').unlink(missing_ok=True)
    (RUNTIME / 'DETENER').unlink(missing_ok=True)
    (RUNTIME / 'activo.lock').rmdir()
    print('Se cerró una conexión anterior que había quedado abierta.', flush=True)
    return True


def ejecutar(publicar=False):
    RUNTIME.mkdir(exist_ok=True)
    parada = RUNTIME / 'DETENER'
    lock = RUNTIME / 'activo.lock'
    try:
        lock.mkdir()
    except FileExistsError:
        # Si la ventana anterior se cerró sin DETENER, su túnel y su entrada quedan sueltos: se cierran aquí.
        if not limpiar_interrumpido():
            raise RuntimeError('Ya hay una entrada iniciada. Usa DETENER ACCESO INTERNET.bat antes de iniciar otra.')
        lock.mkdir()
    procesos = []
    salida = None
    dato = {'activo': False, 'senal': time.time()}
    try:
        parada.unlink(missing_ok=True)
        with urllib.request.urlopen('http://127.0.0.1:8765/api/info', timeout=10) as f:
            info = json.load(f)
        if info.get('version_servidor') != '2026.11.04.2':
            raise RuntimeError('Primero ejecuta REINICIAR SERVIDOR.bat como administrador para activar el portal nuevo.')
        cf = shutil.which('cloudflared')
        if not cf:
            raise RuntimeError('Falta cloudflared, que se instala desde el sitio oficial de Cloudflare.')
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        salida = (RUNTIME / 'conexion.log').open('w', encoding='utf-8')
        tunel = subprocess.Popen([cf, 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8766'], stdout=salida, stderr=subprocess.STDOUT, creationflags=flags)
        procesos.append(tunel)
        portal = ''
        for _ in range(90):
            texto = (RUNTIME / 'conexion.log').read_text(encoding='utf-8', errors='replace')
            m = re.search(r'https://([a-z0-9-]+\.trycloudflare\.com)\b', texto)
            if m:
                portal = m[0]
                break
            if tunel.poll() is not None:
                break
            time.sleep(1)
        if not portal:
            raise RuntimeError('Cloudflare no entregó una dirección. Consulta conexion.log; no se publicó el administrador.')
        puerta = subprocess.Popen([sys.executable, '-I', str(P / 'acceso_internet.py'), '--dominio', portal.split('://')[1]], stdout=salida, stderr=subprocess.STDOUT, creationflags=flags)
        procesos.append(puerta)
        for _ in range(45):
            try:
                r = urllib.request.Request('http://127.0.0.1:8766/e/' + 'x' * 30, headers={'Host': portal.split('://')[1]})
                with urllib.request.urlopen(r, timeout=3):
                    pass
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break
            except OSError:
                pass
            if puerta.poll() is not None or tunel.poll() is not None:
                raise RuntimeError('No se pudo iniciar la entrada de efectivos.')
            time.sleep(1)
        else:
            raise RuntimeError('No se pudo comprobar la entrada local.')
        entrada = ''
        if publicar:
            entrada = publicar_github(portal)
        dato = {'activo': True, 'portal': portal, 'entrada': entrada, 'senal': time.time(), 'temporal': True}
        atomico(ESTADO, dato)
        atomico(RUNTIME / 'procesos.json', {'supervisor': os.getpid(), 'tunel': tunel.pid, 'entrada': puerta.pid})
        print('Portal HTTPS preparado: ' + portal, flush=True)
        print('Comparte desde Efectivos → Enlace. El administrador continúa solo por su conexión habitual.', flush=True)
        while not parada.exists():
            if any(p.poll() is not None for p in procesos):
                raise RuntimeError('La conexión se cerró. No se anunciarán enlaces de internet caídos.')
            dato['senal'] = time.time()
            atomico(ESTADO, dato)
            threading.Event().wait(10)
    finally:
        dato['activo'] = False
        dato['senal'] = time.time()
        atomico(ESTADO, dato)
        for proceso in reversed(procesos):
            if proceso.poll() is None:
                proceso.terminate()
                try:
                    proceso.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proceso.kill()
        if salida:
            salida.close()
        lock.rmdir()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--publicar-github', action='store_true', help='Actualizar solo docs/config.json y subir su dirección a GitHub Pages ya habilitado.')
    a = p.parse_args()
    try:
        ejecutar(a.publicar_github)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
        print('No se pudo habilitar el acceso: ' + str(e), flush=True)
        sys.exit(1)
