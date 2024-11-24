from a2wsgi import WSGIMiddleware
from livemap.app import app as livemap_app
from starlette.applications import Starlette
from starlette.routing import Mount
from Zope2.Startup.run import make_wsgi_app

import sys
import uvicorn


zope_conf = sys.argv[-1]
zope = make_wsgi_app({}, zope_conf)
zope_wsgi = WSGIMiddleware(zope, workers=2)
livemap_app.threadpool = zope_wsgi.executor
app = Starlette(
    debug=True,
    routes=[
        Mount("/ws/livemap", app=livemap_app),
        Mount("/", app=zope_wsgi),
    ],
)

if __name__ == "__main__":
    uvicorn.run(
        app=app,
        host="0.0.0.0",
        port=8080,
    )
