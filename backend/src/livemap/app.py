from AccessControl.SecurityManagement import newSecurityManager
from collections import defaultdict
from plone import api
from plone.keyring.interfaces import IKeyManager
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket
from starlette.websockets import WebSocketDisconnect
from zope.component import getUtility
from zope.component.hooks import setSite

import asyncio
import jwt
import logging
import pydantic
import transaction
import Zope2


logger = logging.getLogger("uvicorn.error")


class Visitor(pydantic.BaseModel):
    """Represents a connection / visitor"""

    model_config = pydantic.ConfigDict(arbitrary_types_allowed=True)

    websocket: WebSocket
    uid: str
    user_id: str | None = None
    location: str | None = None
    name: str = ""
    active: bool = True

    def __hash__(self):
        return hash(self.uid)

    def to_public_json(self) -> dict:
        return {
            "uid": self.uid,
            "active": self.active,
            "location": self.location,
            "name": self.name,
        }


class Channel:
    """Manages active websocket visitors for one block"""

    visitors: dict[str, Visitor]

    def __init__(self):
        self.visitors = {}

    async def connect(self, visitor: Visitor):
        await visitor.websocket.accept()
        if visitor.uid in self.visitors:
            old = self.visitors[visitor.uid]
            if old.active:
                await old.websocket.close()
        self.visitors[visitor.uid] = visitor
        logger.info(f"connected: {visitor.uid}")

    def disconnect(self, visitor: Visitor):
        visitor.active = False
        logger.info(f"disconnected: {visitor.uid}")

    async def send(self, message: dict):
        logger.info(f"send: {message}")
        async with asyncio.TaskGroup() as tg:
            for visitor in self.visitors.values():
                if visitor.active:
                    tg.create_task(visitor.websocket.send_json(message))

    async def follow(self, visitor: Visitor):
        while True:
            data = await visitor.websocket.receive_json()
            visitor.location = data.get("location")
            name = data.get("name", "")
            if visitor.user_id and name != visitor.name:
                await run_plone_func(visitor.user_id, save_name_to_profile, name)
            visitor.name = name
            s = visitor.to_public_json()
            logger.info(f"update: {s}")
            await self.send(s)


channels = defaultdict(Channel)


async def stream(websocket: WebSocket):
    """Main websocket route"""
    app.event_loop = asyncio.get_event_loop()

    block_id = websocket.query_params["block_id"]
    uid = websocket.query_params["uid"]
    user_id = await get_userid_from_websocket(websocket)

    channel = channels[block_id]
    visitor = Visitor(websocket=websocket, uid=uid, user_id=user_id)
    await channel.connect(visitor)
    try:
        # send existing visitors
        for peer in channel.visitors.values():
            await visitor.websocket.send_json(peer.to_public_json())

        # listen for updates
        await channel.follow(visitor)
    except WebSocketDisconnect:
        channel.disconnect(visitor)
        visitor.active = False
        await channel.send(visitor.to_public_json())


app = Starlette(
    routes=[WebSocketRoute("/stream", endpoint=stream)],
)


async def run_plone_func(userid, func, *args):
    return await asyncio.get_event_loop().run_in_executor(
        app.threadpool, _run_plone_func, userid, func, *args
    )


def _run_plone_func(userid, func, *args):
    app = Zope2.bobo_application()
    setSite(app.Plone)
    if userid:
        user = api.user.get(userid)
        newSecurityManager(None, user.getUser())
    result = func(*args)
    transaction.commit()
    app._p_jar.close()
    return result


def save_name_to_profile(name):
    user = api.user.get_current()
    user.setMemberProperties({"fullname": name})


async def get_userid_from_websocket(websocket):
    token = websocket.cookies.get("auth_token")
    if token:
        payload = await run_plone_func(None, get_auth_from_token, token)
        if payload:
            return payload["sub"]


def get_auth_from_token(token):
    manager = getUtility(IKeyManager)
    for secret in manager["_system"]:
        if secret is None:
            continue
        payload = _jwt_decode(token, secret + "/Plone/acl_users/jwt_auth")
        if payload is not None:
            return payload


def _jwt_decode(token, secret):
    token = token.encode("utf-8")
    try:
        return jwt.decode(
            token,
            secret,
            options={"verify_signature": False},
            algorithms=["HS256"],
        )
    except jwt.InvalidTokenError:
        pass


def handle_user_properties_updated(member, event):
    user_id = member.getId()
    if "fullname" not in event.properties:
        return
    name = member.getProperty("fullname")
    for channel in channels.values():
        for visitor in channel.visitors.values():
            if visitor.user_id == user_id:
                visitor.name = name
                asyncio.run_coroutine_threadsafe(
                    channel.send(visitor.to_public_json()), app.event_loop
                )
