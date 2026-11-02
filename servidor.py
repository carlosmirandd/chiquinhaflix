#!/usr/bin/env python3
"""Servidor local do ChiquinhaFlix.

Serve os arquivos da pasta e, quando o app pede o agenda.json, atualiza a agenda
sozinho (no máximo a cada 5 minutos; se o SuperFlix limitar, espera 1 minuto).

Uso:
    python servidor.py            # http://localhost:8000
    python servidor.py --lan      # também acessível por outros aparelhos da sua rede
"""
import importlib.util
import os
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("atualizar_agenda", os.path.join(RAIZ, "tools", "atualizar_agenda.py"))
agenda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agenda)

trava = threading.Lock()
proxima_tentativa = 0.0


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        global proxima_tentativa
        if self.path.split("?")[0] == "/agenda.json" and time.time() >= proxima_tentativa:
            with trava:
                if time.time() >= proxima_tentativa:
                    ok, msg = agenda.atualizar()
                    print("[agenda]", msg)
                    if not ok:
                        proxima_tentativa = time.time() + 60
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    porta = 8000
    print("ChiquinhaFlix em http://localhost:%d  (Ctrl+C para parar)" % porta)
    ThreadingHTTPServer((host, porta), partial(Handler, directory=RAIZ)).serve_forever()
