"""Portal personal: permisos y flujo de envío, solo base temporal y datos ficticios."""
import datetime as dt
import json
import time
import unittest
import urllib.parse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from servidor_test import PruebasServidor


class PruebasPortal(PruebasServidor):
    def test_enlace_publico_solo_se_anuncia_con_conexion_reciente(self):
        self.preparar()
        ruta = Path(self.tmp.name) / 'acceso_internet.json'
        try:
            def info():
                return json.loads(self.peticion('GET', '/api/info')[1]).get('publicacion')
            ruta.write_text(json.dumps({'activo': True, 'portal': 'https://prueba.example.test', 'senal': time.time(), 'entrada': 'https://numbrsword.github.io/mis-carpetas/'}), encoding='utf-8')
            self.assertEqual(info()['portal'], 'https://prueba.example.test')
            for cambio in [{'activo': False}, {'senal': time.time()-100}, {'portal': 'http://prueba.example.test'}, {'portal': 'https://clave@prueba.example.test'}, {'portal': 'https://prueba.example.test/admin'}]:
                ruta.write_text(json.dumps({'activo': True, 'portal': 'https://prueba.example.test', 'senal': time.time(), **cambio}), encoding='utf-8')
                self.assertIsNone(info())
        finally:
            ruta.unlink(missing_ok=True)

    def preparar(self, homonimo=False, aviso=7):
        personal = [{'id': 'A', 'grado': 'S2 PNP', 'nombre': 'PEREZ GOMEZ ANA'}, {'id': 'B', 'grado': 'S1 PNP', 'nombre': 'RIVERA SOL LUIS'}]
        if homonimo:
            personal.append({'id': 'C', 'nombre': 'PEREZ GOMEZ JUAN'})
        self.store = {'edits': {'PRUEBA-1': {'resp': 'S2 PNP PEREZ GOMEZ ANA'}, 'PRUEBA-2': {'resp': 'S1 PNP RIVERA SOL LUIS'}, 'PRUEBA-3': {'resp': 'S2 PNP PEREZ GOMEZ ANA'}}, 'cfg': {'aviso': aviso, 'rolV': 4, 'personalV': 1, 'memoV': 1}, 'efectivos': personal, 'nuevos': [
            {'id': 'CASO-A', 'cf': 'CF VENCIDA FICTICIA', 'resp': 'S2 PNP PEREZ GOMEZ ANA', 'venc': (dt.date.today()-dt.timedelta(days=2)).isoformat(), 'rem': 'NO'},
            {'id': 'ADIC-A', 'adic': 'CASO-A', 'cf': 'ADICIONAL FICTICIO', 'resp': 'S2 PNP PEREZ GOMEZ ANA', 'rem': 'NO'},
            {'id': 'PRONTO-A', 'cf': 'CF PRONTA FICTICIA', 'resp': 'S2 PNP PEREZ GOMEZ ANA', 'venc': (dt.date.today()+dt.timedelta(days=2)).isoformat(), 'rem': 'NO'}]}
        self.guardar()
        return self.token('A'), self.token('B')

    def guardar(self):
        self.assertEqual(self.peticion('PUT', '/api/estado', {'version': self.estado()['version'], 'store': self.store})[0], 200)

    def token(self, ef, nuevo=False):
        codigo, cuerpo = self.peticion('POST', '/api/enlace', {'efectivo': ef, 'nuevo': nuevo})
        self.assertEqual(codigo, 200)
        return json.loads(cuerpo)['token']

    def archivo(self, clave):
        self.assertEqual(self.peticion('PUT', '/api/adjunto?'+urllib.parse.urlencode({'k': clave, 'n': 'ficticio.pdf', 't': 'application/pdf'}), b'%PDF-ficticio')[0], 200)

    def test_portal_solo_muestra_propias_y_recordatorios(self):
        a, _ = self.preparar()
        codigo, cuerpo = self.peticion('GET', '/e/'+a)
        self.assertEqual(codigo, 200)
        texto = cuerpo.decode()
        self.assertIn('CF 257-2026', texto)
        self.assertNotIn('CF 100-2026', texto)
        self.assertIn('vencida hace 2 día(s)', texto)
        self.assertNotIn('CF 101-2026', texto)
        self.assertIn('Recordatorios', texto)
        self.assertNotIn('__OPCIONES__', texto)

    def test_archivos_ajenos_no_accesibles_aunque_conozca_clave(self):
        a, b = self.preparar()
        self.archivo('PRUEBA-1|dec')
        self.archivo('PRUEBA-2|dec')
        propia = '/e/'+a+'/archivo?k='+urllib.parse.quote('PRUEBA-1|dec')
        ajena = '/e/'+a+'/archivo?k='+urllib.parse.quote('PRUEBA-2|dec')
        self.assertEqual(self.peticion('GET', propia)[1], b'%PDF-ficticio')
        self.assertEqual(self.peticion('GET', ajena)[0], 403)
        self.assertEqual(self.peticion('GET', '/e/'+b+'/archivo?k='+urllib.parse.quote('PRUEBA-1|dec'))[0], 403)

    def test_envio_propio_llega_por_revisar_y_no_descarga_carpeta(self):
        a, _ = self.preparar()
        anterior = self.estado()['store']
        codigo, _ = self.peticion('POST', '/e/'+a+'/enviar', b'%PDF-ficticio', {'X-Carpeta': 'PRUEBA-1', 'X-Tipo': 'ampliacion', 'Content-Type': 'application/pdf', 'X-Nombre': 'informe.pdf'})
        self.assertEqual(codigo, 200)
        # Por ahora el efectivo solo envía cargo o ampliación (decisión del usuario).
        self.assertEqual(self.peticion('POST', '/e/'+a+'/enviar', b'%PDF-ficticio', {'X-Carpeta': 'PRUEBA-1', 'X-Tipo': 'informe', 'Content-Type': 'application/pdf'})[0], 400)
        self.assertEqual(self.estado()['store'], anterior)
        envios = json.loads(self.peticion('GET', '/api/envios')[1])
        envio = next(x for x in envios if x['carpeta'] == 'PRUEBA-1' and x['efectivo'] == 'A')
        self.assertEqual(envio['estado'], 'nuevo')
        self.peticion('POST', '/api/envio/estado', {'id': envio['id'], 'estado': 'aceptado'})
        self.assertIn('Recibido', self.peticion('GET', '/e/'+a)[1].decode())

    def test_no_envia_para_carpeta_ajena_ni_cerrada(self):
        a, _ = self.preparar()
        for carpeta in ('PRUEBA-2', 'PRUEBA-3', 'ADIC-A'):
            self.assertEqual(self.peticion('POST', '/e/'+a+'/enviar', b'%PDF-ficticio', {'X-Carpeta': carpeta, 'X-Tipo': 'ampliacion', 'Content-Type': 'application/pdf'})[0], 400)

    def test_rotar_enlace_invalida_portal_y_archivos_anteriores(self):
        a, _ = self.preparar()
        self.archivo('PRUEBA-1|dec')
        nuevo = self.token('A', nuevo=True)
        self.assertNotEqual(a, nuevo)
        self.assertEqual(self.peticion('GET', '/e/'+a)[0], 404)
        self.assertEqual(self.peticion('GET', '/e/'+a+'/archivo?k=PRUEBA-1%7Cdec')[0], 404)

    def test_cambio_de_instructor_revoca_acceso_al_archivo(self):
        a, _ = self.preparar()
        self.archivo('PRUEBA-1|dec')
        self.store['edits']['PRUEBA-1']['resp'] = 'S1 PNP RIVERA SOL LUIS'
        self.guardar()
        self.assertEqual(self.peticion('GET', '/e/'+a+'/archivo?k=PRUEBA-1%7Cdec')[0], 403)

    def test_homonimos_no_comparten_carpeta_por_solo_apellidos(self):
        a, _ = self.preparar(homonimo=True)
        c = self.token('C')
        self.assertNotIn('CF 257-2026', self.peticion('GET', '/e/'+c)[1].decode())
        self.store['edits']['PRUEBA-1']['resp'] = 'S2 PNP PEREZ GOMEZ'
        self.guardar()
        self.assertNotIn('CF 257-2026', self.peticion('GET', '/e/'+a)[1].decode())

    def test_documento_adicional_y_cerrado_solo_para_su_efectivo(self):
        a, b = self.preparar()
        for clave in ('ADIC-A|dec', 'PRUEBA-3|car'):
            self.archivo(clave)
            self.assertEqual(self.peticion('GET', '/e/'+a+'/archivo?k='+urllib.parse.quote(clave))[0], 200)
            self.assertEqual(self.peticion('GET', '/e/'+b+'/archivo?k='+urllib.parse.quote(clave))[0], 403)

    def test_aviso_cero_no_se_convierte_en_siete_dias(self):
        a, _ = self.preparar(aviso=0)
        self.assertIn('Vencen pronto: 0', self.peticion('GET', '/e/'+a)[1].decode())


if __name__ == '__main__':
    resultado = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PruebasPortal))
    sys.exit(not resultado.wasSuccessful())
