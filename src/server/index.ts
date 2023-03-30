import express from "express";
import {KeyStore} from "./KeyStore";
import {RoomStore} from "./RoomStore";
import {ClientServerApi} from "./client-server";
import {Runtime} from "./Runtime";
import {SelfSigningKey} from "./SelfSigningKey";

const port: number = Number(process.env["LM_PORT"] ?? 3000);
const serverName = `localhost:${port}`;
const app = express();

console.log("Server name: ", serverName);

// Set up runtime before moving on
Runtime.signingKey = new SelfSigningKey(serverName);

// Start registering routes and stuff
const roomStore = new RoomStore();
new ClientServerApi(serverName, roomStore).registerRoutes(app);
new KeyStore().registerRoutes(app);

app.listen(port, () => console.log(`Listening on ${port}`));
