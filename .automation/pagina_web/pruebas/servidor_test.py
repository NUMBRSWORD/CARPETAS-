"""Pruebas HTTP con base temporal y datos ficticios; nunca usa datos_servidor/."""
import concurrent.futures
import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

P = Path(__file__).resolve().parent
ESTADO = {'edits': {}, 'nuevos': [], 'cfg': {'aviso': 7}, 'efectivos': []}


class PruebasServidor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='cf_prueba_', dir=P)
        assert Path(cls.tmp.name).resolve().is_relative_to(P)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.puerto = s.getsockname()[1]
        cls.proceso = subprocess.Popen([sys.executable, '-I', str(P.parent / 'servidor.py'), '--datos', cls.tmp.name, '--puerto', str(cls.puerto), '--pagina', str(P / 'vista_ficticia.html')], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        listo = False
        for _ in range(60):
            try:
                cls.peticion('GET', '/api/estado')
                listo = True
                break
            except OSError:
                if cls.proceso.poll() is not None:
                    break
                time.sleep(.1)
        if not listo:
            cls.proceso.terminate()
            error = cls.proceso.communicate(timeout=10)[1].decode(errors='replace')
            cls.tmp.cleanup()
            raise RuntimeError('No se pudo conectar al servidor de prueba. ' + error)

    @classmethod
    def tearDownClass(cls):
        cls.proceso.terminate()
        cls.proceso.communicate(timeout=10)
        cls.tmp.cleanup()

    @classmethod
    def peticion(cls, metodo, ruta, cuerpo=None, cab=None):
        c = http.client.HTTPConnection('127.0.0.1', cls.puerto, timeout=5)
        if isinstance(cuerpo, (dict, list)):
            cuerpo = json.dumps(cuerpo).encode()
        c.request(metodo, ruta, body=cuerpo, headers={'X-Carpetas': '1', **(cab or {})})
        r = c.getresponse()
        salida = r.status, r.read()
        c.close()
        return salida

    def estado(self):
        return json.loads(self.peticion('GET', '/api/estado')[1])

    def test_guardado_y_reintento_sin_duplicar_version(self):
        v = self.estado()['version']
        cuerpo = {'version': v, 'store': {**ESTADO, 'cfg': {'aviso': 9}}}
        codigo, b = self.peticion('PUT', '/api/estado', cuerpo)
        self.assertEqual(codigo, 200)
        self.assertEqual(json.loads(b)['version'], v + 1)
        self.assertEqual(self.peticion('PUT', '/api/estado', cuerpo), (codigo, b))

    def test_dos_ventanas_no_sobrescriben(self):
        version = self.estado()['version']
        def guardar(i):
            return self.peticion('PUT', '/api/estado', {'version': version, 'store': {**ESTADO, 'cfg': {'aviso': i}}})[0]
        with concurrent.futures.ThreadPoolExecutor(2) as ejecutor:
            self.assertEqual(sorted(ejecutor.map(guardar, [21, 22])), [200, 409])

    def test_formato_invalido_no_cambia_estado(self):
        anterior = self.estado()
        for cuerpo in [[], b'{mal', {'version': 0, 'store': {}}, {'version': True, 'store': ESTADO}, {'version': 'abc', 'store': ESTADO}, {'version': anterior['version'], 'store': {**ESTADO, 'nuevos': [{'id': 'x'}, {'id': 'x'}]}}]:
            self.assertEqual(self.peticion('PUT', '/api/estado', cuerpo)[0], 400)
            self.assertEqual(self.estado(), anterior)

    def test_documentos_validacion_y_ciclo_completo(self):
        self.assertEqual(self.peticion('PUT', '/api/adjunto', b'prueba')[0], 400)
        self.assertEqual(self.peticion('PUT', '/api/adjunto?k=PRUEBA%7Cdec', b'')[0], 400)
        self.assertEqual(self.peticion('PUT', '/api/adjunto?k=PRUEBA%7Cdec&n=ficticio.pdf&t=application/pdf', b'%PDF-ficticio')[0], 200)
        self.assertEqual(self.peticion('GET', '/api/adjunto?k=PRUEBA%7Cdec')[1], b'%PDF-ficticio')
        self.assertEqual(self.peticion('DELETE', '/api/adjunto?k=PRUEBA%7Cdec')[0], 200)
        self.assertEqual(self.peticion('GET', '/api/adjunto?k=PRUEBA%7Cdec')[0], 404)

    def test_envios_invalidos(self):
        self.assertEqual(self.peticion('POST', '/api/envio/estado', [1])[0], 400)
        self.assertEqual(self.peticion('POST', '/api/envio/estado', {'id': 'mal', 'estado': 'aceptado'})[0], 400)
        self.assertEqual(self.peticion('POST', '/api/envio/estado', {'id': 999, 'estado': 'aceptado'})[0], 404)

    def test_longitud_y_permisos(self):
        self.assertEqual(self.peticion('PUT', '/api/estado', b'', {'Content-Length': '-1'})[0], 400)
        self.assertEqual(self.peticion('PUT', '/api/estado', b'', {'Content-Length': str(21*1024*1024)})[0], 413)
        self.assertEqual(self.peticion('PUT', '/api/estado', {}, {'X-Carpetas': ''})[0], 403)


if __name__ == '__main__':
    unittest.main(verbosity=2)
