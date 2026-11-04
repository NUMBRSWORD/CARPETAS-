"""Comprueba la separación entre el repositorio y los datos de esta instalación."""
import json
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]
P = ROOT / '.automation/pagina_web'


class PruebasCodigo(unittest.TestCase):
    def test_git_excluye_datos_y_paginas_generadas(self):
        rutas = ['datos_servidor/carpetas.db', 'datos_servidor/config.json', 'privado.xlsx',
                 'outputs/pagina_web_ventanilla/CARPETAS_FISCALES_VENTANILLA.html',
                 '.automation/pagina_web/privado_local.json', '.automation/pagina_web/personal_2026.json',
                 '.automation/pagina_web/pruebas/vista_ficticia.html',
                 '.automation/respaldo_git_20261104/construir.py', 'respaldos/copia.json',
                 'CLAUDE.md', '.automation/pagina_web/vendor/cualquiera.js']
        r = subprocess.run(['git', 'check-ignore', '-z', '--stdin'], input=('\x00'.join(rutas)+'\x00').encode(),
                           cwd=ROOT, capture_output=True, check=True)
        self.assertEqual(set(r.stdout.decode().strip('\x00').split('\x00')), set(rutas))

    def test_indice_solo_contiene_codigo_permitido(self):
        r = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True)
        rutas = r.stdout.decode().strip('\x00').split('\x00')
        self.assertIn('.automation/pagina_web/servidor.py', rutas)
        for ruta in rutas:
            self.assertNotRegex(ruta.lower(), r'\.(db|xlsx|pdf|docx|png|jpg|zip|exe|pem)$')
            self.assertNotIn('privado_local.json', ruta)
            self.assertNotIn('personal_2026.json', ruta)
            self.assertNotIn('outputs/', ruta)
            self.assertNotIn('datos_servidor/', ruta)
            self.assertLess((ROOT / ruta).stat().st_size, 200_000)

    def test_personalizacion_no_esta_en_codigo_publicable(self):
        privado = P / 'privado_local.json'
        if not privado.exists():
            self.skipTest('Clon sin personalización real: no hay datos locales que comparar.')
        datos = json.loads(privado.read_text(encoding='utf-8'))
        textos = '\n'.join((P / n).read_text(encoding='utf-8') for n in
                           ('construir.py', 'plantilla.html', 'lote.js', 'guia.html'))
        nombres = [datos['firma']['fNom'], *datos['grado_rol'], *datos['rol_inactivo_v1']]
        nombres += [n for lista in datos['rol_seccion'].values() for n in lista]
        for nombre in nombres:
            if nombre:
                self.assertNotIn(nombre, textos)
        for clave in datos['datos_decreto']:
            self.assertNotIn(clave, textos)
        for clave in datos['adicionales']:
            self.assertNotIn(clave, textos)

    def test_regeneracion_conserva_datos_recursos_y_personal(self):
        ruta = ROOT / '.automation/respaldo_git_20261104/contenido_antes.json'
        if not ruta.exists():
            self.skipTest('Solo se compara en la PC original que conserva el respaldo.')
        anterior = json.loads(ruta.read_text(encoding='utf-8'))
        pagina = (ROOT / 'outputs/pagina_web_ventanilla/CARPETAS_FISCALES_VENTANILLA.html').read_text(encoding='utf-8')
        for clave, valor in anterior.items():
            actual = json.loads(re.search(r'<script type="application/json" id="' + clave + r'">(.*?)</script>', pagina, re.S)[1])
            self.assertEqual(actual, valor, clave + ': la separación no debe alterar registros ni recursos')
        local = json.loads((P / 'privado_local.json').read_text(encoding='utf-8'))
        inyectado = json.loads(re.search(r'<script type="application/json" id="personalizacion">(.*?)</script>', pagina, re.S)[1])
        for clave, valor in inyectado.items():
            self.assertEqual(valor, local[clave])


if __name__ == '__main__':
    unittest.main(verbosity=2)
