"""Restauración atómica y copias coherentes, únicamente en una base ficticia."""
import base64
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parent))
from servidor_test import PruebasServidor, ESTADO
import unittest


class PruebasAvanzadas(PruebasServidor):
    def documento(self, clave, datos=b'ficticio'):
        return {'clave': clave, 'nombre': 'ficticio.pdf', 'tipo': 'application/pdf', 'datos': base64.b64encode(datos).decode()}

    def restaurar(self, archivos, aviso=15):
        return self.peticion('POST', '/api/restaurar', {'version': self.estado()['version'], 'store': {**ESTADO, 'cfg': {'aviso': aviso}}, 'adjuntos': archivos})

    def test_restauracion_y_copia_anterior(self):
        antes = self.estado()
        self.assertEqual(self.restaurar([self.documento('ATOMICO|dec')])[0], 200)
        self.assertEqual(self.estado()['store']['cfg']['aviso'], 15)
        self.assertEqual(self.peticion('GET', '/api/adjunto?k=ATOMICO%7Cdec')[1], b'ficticio')
        copias = sorted((Path(self.tmp.name)/'respaldos').glob('antes_restaurar_*.db'), key=lambda p:p.stat().st_mtime)
        with closing(sqlite3.connect(copias[-1])) as copia:
            fila = copia.execute('SELECT datos, version FROM estado').fetchone()
            self.assertEqual(json.loads(fila[0]) if fila else None, antes['store'])

    def test_documento_danado_no_deja_carga_parcial(self):
        antes = self.estado()
        malo = self.documento('INVALIDO|dec')
        malo['datos'] = '!!!!'
        self.assertEqual(self.restaurar([self.documento('NO_DEBE_EXISTIR|dec'), malo])[0], 400)
        self.assertEqual(self.estado(), antes)
        self.assertEqual(self.peticion('GET', '/api/adjunto?k=NO_DEBE_EXISTIR%7Cdec')[0], 404)

    def test_error_sql_revierte_estado_y_todos_los_documentos(self):
        antes = self.estado()
        ruta = Path(self.tmp.name)/'carpetas.db'
        with closing(sqlite3.connect(ruta)) as db, db:
            db.execute("CREATE TRIGGER falla_prueba BEFORE INSERT ON adjuntos WHEN NEW.clave='ROMPER' BEGIN SELECT RAISE(ABORT,'fallo ficticio'); END")
        try:
            self.assertEqual(self.restaurar([self.documento('TAMPOCO'), self.documento('ROMPER')])[0], 503)
            self.assertEqual(self.estado(), antes)
            self.assertEqual(self.peticion('GET', '/api/adjunto?k=TAMPOCO')[0], 404)
        finally:
            with closing(sqlite3.connect(ruta)) as db, db:
                db.execute('DROP TRIGGER falla_prueba')

    def test_conflicto_restauracion_no_toca_archivos(self):
        antes = self.estado()
        self.assertEqual(self.peticion('POST', '/api/restaurar', {'version': antes['version']+100, 'store': ESTADO, 'adjuntos': [self.documento('CONFLICTO')]})[0], 409)
        self.assertEqual(self.estado(), antes)
        self.assertEqual(self.peticion('GET', '/api/adjunto?k=CONFLICTO')[0], 404)

    def test_descargas_json_y_sqlite_incluyen_documentos(self):
        self.assertEqual(self.restaurar([self.documento('COPIA|car',b'contenido exacto')], aviso=28)[0], 200)
        codigo, datos = self.peticion('GET', '/api/respaldo?formato=json')
        self.assertEqual(codigo, 200)
        copia = json.loads(datos)
        self.assertEqual(copia['cfg']['aviso'], 28)
        self.assertEqual(base64.b64decode(next(a for a in copia['adjuntos'] if a['clave']=='COPIA|car')['datos']),b'contenido exacto')
        codigo, datos = self.peticion('GET','/api/respaldo')
        self.assertEqual(codigo, 200)
        with closing(sqlite3.connect(':memory:')) as db:
            db.deserialize(datos)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute("SELECT datos FROM adjuntos WHERE clave='COPIA|car'").fetchone()[0], b'contenido exacto')

    def test_copia_diaria_se_actualiza_despues_de_un_adjunto(self):
        self.assertEqual(self.peticion('PUT','/api/adjunto?k=DIARIO',b'ultimo cambio')[0],200)
        for _ in range(50):
            info = json.loads(self.peticion('GET','/api/info')[1])
            if not info['respaldo']['pendiente']:
                break
            time.sleep(.1)
        self.assertFalse(info['respaldo']['pendiente'])
        diario = next((Path(self.tmp.name)/'respaldos').glob('carpetas_20??-??-??.db'))
        with closing(sqlite3.connect(diario)) as db:
            self.assertEqual(db.execute("SELECT datos FROM adjuntos WHERE clave='DIARIO'").fetchone()[0], b'ultimo cambio')

    def test_rechaza_configuracion_invalida_y_claves_peligrosas(self):
        antes = self.estado()
        for aviso in [-1, 366, 'mal', None]:
            self.assertEqual(self.restaurar([],aviso)[0],400)
        store={**ESTADO, 'edits': {'__proto__': {}}}
        self.assertEqual(self.peticion('PUT','/api/estado',{'version':antes['version'],'store':store})[0],400)
        self.assertEqual(self.estado(), antes)


if __name__ == '__main__':
    # Cargar solamente la clase derivada: incluye las seis pruebas HTTP existentes.
    resultado = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PruebasAvanzadas))
    sys.exit(not resultado.wasSuccessful())
