import express from "express";
import {Keyserver} from "./keyserver";
import {RoomServer} from "./room-server";
import {ClientServerApi} from "./client-server";

const port: number = Number(process.env["LM_PORT"] ?? 3000);
const serverName = `localhost:${port}`;
const app = express();

console.log("Server name: ", serverName);

const roomServer = new RoomServer();
new ClientServerApi(serverName, roomServer).registerRoutes(app);
new Keyserver(serverName).registerRoutes(app);

app.listen(port, () => console.log(`Listening on ${port}`));
