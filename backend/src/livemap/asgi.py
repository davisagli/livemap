from a2wsgi import WSGIMiddleware
from livemap.app import app as livemap_app
from starlette.applications import Starlette
from starlette.routing import Mount
from Zope2.Startup.run import make_wsgi_app

import sys
import uvicorn


def make_app():
    zope_conf = sys.argv[-1]
    zope = make_wsgi_app({}, zope_conf)
    return Starlette(
        debug=True,
        routes=[
            Mount("/ws/livemap", app=livemap_app),
            Mount("/", app=WSGIMiddleware(zope, workers=2)),
        ],
    )


if __name__ == "__main__":
    uvicorn.run(
        app="livemap.asgi:make_app",
        host="127.0.0.1",
        port=8080,
        # reload=True,
    )
