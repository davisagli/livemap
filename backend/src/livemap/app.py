from collections import defaultdict
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket
from starlette.websockets import WebSocketDisconnect
from typing import Set
from user_agents import parse

import logging
import pydantic


logger = logging.getLogger("uvicorn.error")


class Visitor(pydantic.BaseModel):
    """Represents a connection / visitor"""

    model_config = pydantic.ConfigDict(arbitrary_types_allowed=True)

    websocket: WebSocket
    uid: str
    device: str
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
            "device": self.device,
            "name": self.name,
        }


class Channel:
    """Manages active websocket visitors for one block"""

    active: Set[Visitor]

    def __init__(self):
        self.active = set()

    async def connect(self, visitor: Visitor):
        await visitor.websocket.accept()
        self.active.add(visitor)
        logger.info(f"connected: {visitor.uid}")

    def disconnect(self, visitor: Visitor):
        visitor.active = False
        self.active.remove(visitor)
        logger.info(f"disconnected: {visitor.uid}")

    async def send(self, message: dict):
        for visitor in self.active:
            # todo: await in parallel
            await visitor.websocket.send_json(message)

    async def follow(self, visitor: Visitor):
        while True:
            data = await visitor.websocket.receive_json()
            visitor.location = data.get("location")
            visitor.name = data.get("name", "")
            s = visitor.to_public_json()
            logger.info(f"update: {s}")
            await self.send(s)


channels = defaultdict(Channel)


async def stream(websocket: WebSocket):
    """Main websocket route"""
    block_id = websocket.query_params["block_id"]
    user_id = websocket.query_params["user_id"]
    user_agent = websocket.headers["User-Agent"]
    device = parse(user_agent).browser.family

    channel = channels[block_id]
    visitor = Visitor(websocket=websocket, uid=user_id, device=device)
    await channel.connect(visitor)
    try:
        # send existing visitors
        for peer in channel.active:
            # todo: await in parallel
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
