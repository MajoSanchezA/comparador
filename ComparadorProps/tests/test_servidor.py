import base64
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
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


if __name__ == "__main__":
    unittest.main()
