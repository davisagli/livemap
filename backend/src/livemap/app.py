from collections import defaultdict
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket
from starlette.websockets import WebSocketDisconnect

import asyncio
import logging
import pydantic


logger = logging.getLogger("uvicorn.error")


class Visitor(pydantic.BaseModel):
    """Represents a connection / visitor"""

    model_config = pydantic.ConfigDict(arbitrary_types_allowed=True)

    websocket: WebSocket
    uid: str
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
        async with asyncio.TaskGroup() as tg:
            for visitor in self.visitors.values():
                if visitor.active:
                    tg.create_task(visitor.websocket.send_json(message))

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

    channel = channels[block_id]
    visitor = Visitor(websocket=websocket, uid=user_id)
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
