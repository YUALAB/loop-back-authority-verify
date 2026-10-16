"""論文 006 の人の採点：apps/ を配り、POST /save で ratings.json に保存する（key.json は配らない）
使い方: python3 bench/artifact-bench/human-rating/serve.py  → http://localhost:3121/
"""
import http.server, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ratings.json')

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=os.path.join(HERE, 'apps'), **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == '/ratings':
            body = open(OUT, 'rb').read() if os.path.exists(OUT) else b'{}'
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body); return
        super().do_GET()
    def do_POST(self):
        if self.path != '/save': self.send_error(404); return
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with open(OUT, 'w') as f: json.dump(data, f, ensure_ascii=False, indent=1)
        self.send_response(204); self.end_headers()

http.server.ThreadingHTTPServer(('127.0.0.1', 3121), H).serve_forever()
