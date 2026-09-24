import base64
import gc
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "app"))
import servidor


class SeguridadDeArchivosTest(unittest.TestCase):
    def test_reconoce_formatos_por_sus_bytes(self):
        self.assertEqual(servidor.formato_imagen(b"\x89PNG\r\n\x1a\nresto"), ".png")
        self.assertEqual(servidor.formato_imagen(b"texto plano"), None)

    def test_rechaza_carga_que_no_es_imagen(self):
        carga = base64.b64encode(b"no soy una imagen").decode()
        with self.assertRaises(ValueError):
            servidor.decodificar_imagen(carga)

    def test_ruta_segura_no_sale_de_su_raiz(self):
        with tempfile.TemporaryDirectory() as raiz:
            self.assertTrue(servidor.ruta_segura(raiz, "archivo.txt").startswith(os.path.realpath(raiz)))
            with self.assertRaises(ValueError):
                servidor.ruta_segura(raiz, "../secreto.txt")


class ActividadTest(unittest.TestCase):
    def test_historial_se_ordena_por_fecha_mas_reciente(self):
        with tempfile.TemporaryDirectory() as temporal:
            originales = {nombre: getattr(servidor, nombre) for nombre in
                           ("DATOS", "BD", "BIBLIOTECA", "PAPELERA", "PROYECTOS", "RESPALDOS")}
            try:
                servidor.DATOS = temporal
                servidor.BD = os.path.join(temporal, "biblioteca.db")
                servidor.BIBLIOTECA = os.path.join(temporal, "biblioteca")
                servidor.PAPELERA = os.path.join(temporal, "papelera")
                servidor.PROYECTOS = os.path.join(temporal, "proyectos")
                servidor.RESPALDOS = os.path.join(temporal, "respaldos")
                servidor.preparar_bd()
                cx = servidor.conectar()
                try:
                    servidor.registrar_actividad(cx, 1, "Subió v1", "Tuku", "EP01", "SH01", "Nido", "Ana")
                    servidor.registrar_actividad(cx, 2, "Aprobó v2", "Tuku", "EP01", "SH01", "Nido", "Luis")
                    cx.commit()
                finally:
                    cx.close()
                historial = servidor.actividad_de("Tuku", "EP01", "SH01", "Nido")
                self.assertEqual([x["accion"] for x in historial], ["Aprobó v2", "Subió v1"])
            finally:
                for nombre, valor in originales.items():
                    setattr(servidor, nombre, valor)
                gc.collect()


if __name__ == "__main__":
    unittest.main()
