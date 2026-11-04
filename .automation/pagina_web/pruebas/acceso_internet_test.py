"""Entrada pública con base temporal; no abre un túnel ni usa información real."""
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
import urllib.parse
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from acceso_internet import Entrada, MAX_ARCHIVO, ruta_permitida
from portal_test import PruebasPortal


class PruebasInternet(PruebasPortal):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.puerta = Entrada(('127.0.0.1', 0), cls.puerto, 'portal.example.test')
        cls.hilo = threading.Thread(target=cls.puerta.serve_forever, daemon=True)
        cls.hilo.start()

    @classmethod
    def tearDownClass(cls):
        cls.puerta.shutdown()
        cls.puerta.server_close()
        cls.hilo.join()
        super().tearDownClass()

    def internet(self, metodo, ruta, datos=None, cab=None):
        c = http.client.HTTPConnection('127.0.0.1', self.puerta.server_address[1], timeout=8)
        c.request(metodo, ruta, body=datos, headers={'Host': 'portal.example.test', **(cab or {})})
        r = c.getresponse()
        salida = r.status, r.read(), dict(r.getheaders())
        c.close()
        return salida

    def test_entrada_no_expone_administracion(self):
        for ruta in ('/', '/index.html', '/api/estado', '/api/enlaces', '/api/respaldo', '/api/envios', '/entrar', '/recursos/word.js'):
            self.assertEqual(self.internet('GET', ruta, cab={'Cookie': 'sesion=falsa', 'X-Carpetas': '1'})[0], 404)
        self.assertEqual(self.internet('PUT', '/api/estado', b'{}', {'X-Carpetas': '1'})[0], 404)

    def test_portal_propio_y_sin_datos_ajenos(self):
        a, _ = self.preparar()
        estado, cuerpo, cab = self.internet('GET', '/e/' + a)
        self.assertEqual(estado, 200)
        self.assertIn(b'Mis carpetas pendientes', cuerpo)
        self.assertNotIn(b'CF 100-2026', cuerpo)
        self.assertEqual(cab['Cache-Control'], 'no-store, private')
        self.assertEqual(cab['Referrer-Policy'], 'no-referrer')
        self.assertIn("frame-ancestors 'none'", cab['Content-Security-Policy'])
        self.assertNotIn('Set-Cookie', cab)

    def test_archivo_ajeno_bloqueado_desde_internet(self):
        a, _ = self.preparar()
        self.archivo('PRUEBA-1|dec')
        self.archivo('PRUEBA-2|dec')
        for clave, esperado in [('PRUEBA-1|dec', 200), ('PRUEBA-2|dec', 403)]:
            ruta = '/e/' + a + '/archivo?k=' + urllib.parse.quote(clave)
            self.assertEqual(self.internet('GET', ruta)[0], esperado)

    def test_envio_llega_sin_confirmar_automaticamente(self):
        a, _ = self.preparar()
        estado = self.estado()
        cab = {'Origin': 'https://portal.example.test', 'X-Carpeta': 'PRUEBA-1', 'X-Tipo': 'ampliacion', 'X-Nombre': 'ficticio.pdf', 'Content-Type': 'application/pdf'}
        self.assertEqual(self.internet('POST', '/e/' + a + '/enviar', b'%PDF-ficticio', cab)[0], 200)
        envios = json.loads(self.peticion('GET', '/api/envios')[1])
        self.assertEqual(envios[0]['estado'], 'nuevo')
        self.assertEqual(self.estado(), estado)

    def test_host_origen_y_metodo_incorrectos(self):
        a, _ = self.preparar()
        self.assertEqual(self.internet('GET', '/e/' + a, cab={'Host': 'otro.example.test'})[0], 400)
        self.assertEqual(self.internet('POST', '/e/' + a + '/enviar', b'x', {'Origin': 'https://otro.example.test'})[0], 403)
        for metodo in ('PUT', 'DELETE', 'OPTIONS', 'PATCH'):
            self.assertEqual(self.internet(metodo, '/e/' + a)[0], 404)

    def test_carga_grande_o_vacia_se_rechaza_antes_del_origen(self):
        a, _ = self.preparar()
        ruta = '/e/' + a + '/enviar'
        self.assertEqual(self.internet('POST', ruta)[0], 400)
        self.assertEqual(self.internet('POST', ruta, cab={'Content-Length': str(MAX_ARCHIVO + 1)})[0], 413)
        self.assertEqual(self.internet('POST', ruta, cab={'Content-Length': '-1'})[0], 400)
        self.assertEqual(self.internet('POST', ruta, cab={'Transfer-Encoding': 'chunked'})[0], 400)

    def test_codigo_revocado_tambien_deja_de_funcionar_en_internet(self):
        a, _ = self.preparar()
        self.token('A', nuevo=True)
        self.assertEqual(self.internet('GET', '/e/' + a)[0], 404)

    def test_no_redireccion_ni_ruta_codificada_a_administracion(self):
        a, _ = self.preparar()
        for ruta in ('https://otro.example.test/e/' + a, '//otro.example.test/e/' + a, '/e/' + a + '/../api/estado', '/e/' + a + '/%2e%2e/api/estado', '/%65/' + a, '/e/' + a + '/enviar?x=1'):
            self.assertFalse(ruta_permitida('POST' if '/enviar?' in ruta else 'GET', ruta))

    def test_limite_de_intentos(self):
        token = 'x' * 30
        for _ in range(10):
            self.assertTrue(self.puerta.permite_frecuencia(token, True))
        self.assertFalse(self.puerta.permite_frecuencia(token, True))
        self.assertTrue(self.puerta.permite_frecuencia(token, False))


if __name__ == '__main__':
    # Solo las nuevas; los ensayos heredados se ejecutan en sus propias suites.
    nombres = sorted(k for k in PruebasInternet.__dict__ if k.startswith('test_'))
    resultado = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(PruebasInternet(k) for k in nombres))
    sys.exit(not resultado.wasSuccessful())
