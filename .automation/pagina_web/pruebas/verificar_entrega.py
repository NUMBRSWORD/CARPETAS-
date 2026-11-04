"""Verificación de entrega: solo lee la base real y el Excel."""
import ast
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import subprocess
from zipfile import ZipFile

P = Path(__file__).resolve().parent
ROOT = P.parents[2]
excel = next(ROOT.glob('CARPETAS FISCALES ACTUALIZADAS 2026*.xlsx'))
pagina = ROOT / 'outputs/pagina_web_ventanilla/CARPETAS_FISCALES_VENTANILLA.html'
with ZipFile(excel) as z:
    assert z.testzip() is None
texto = pagina.read_text(encoding='utf-8')
for marca in ('__DATA__', '__EFECTIVOS__', '__PERSONALIZACION__', '__TEMA__', '__LOTE__', '__PERSISTENCIA__', '__GUIA__'):
    assert marca not in texto, marca
assert pagina.stat().st_mtime >= excel.stat().st_mtime, 'Hay que regenerar con el Excel más reciente'
programa = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', texto, re.S)[-1]
sintaxis = P / 'sintaxis_temporal.js'
try:
    sintaxis.write_text(programa, encoding='utf-8')
    subprocess.run(['node', '--check', str(sintaxis)], check=True)
finally:
    sintaxis.unlink(missing_ok=True)
arbol = ast.parse((P.parent / 'servidor.py').read_text(encoding='utf-8'))
validador = next(n for n in arbol.body if isinstance(n, ast.FunctionDef) and n.name == 'validar_estado')
ambito = {'math': math}
exec(compile(ast.Module(body=[validador], type_ignores=[]), '<validador>', 'exec'), ambito)
with sqlite3.connect((ROOT / 'datos_servidor/carpetas.db').as_uri() + '?mode=ro', uri=True) as bd:
    assert bd.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    fila = bd.execute('SELECT datos FROM estado WHERE id=1').fetchone()
    if fila:
        assert ambito['validar_estado'](json.loads(fila[0])), 'El estado existente debe conservar compatibilidad'
base = json.loads(re.search(r'<script type="application/json" id="base">(.*?)</script>', texto, re.S)[1])
print('OK: Excel legible, página actualizada y JavaScript válido.')
print('OK: base real íntegra y compatible; acceso de solo lectura.')
print('Carpetas incluidas:', len(base))
print('SHA256 Excel:', hashlib.sha256(excel.read_bytes()).hexdigest())
