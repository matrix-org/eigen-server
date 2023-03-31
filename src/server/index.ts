import express from "express";
import {KeyStore} from "./KeyStore";
import {RoomStore} from "./RoomStore";
import {ClientServerApi} from "./client_server_api/ClientServerApi";
import {Runtime} from "./Runtime";
import {SelfSigningKey} from "./SelfSigningKey";

const port: number = Number(process.env["LM_PORT"] ?? 3000);
const serverName = `localhost:${port}`;
const app = express();

console.log("Server name: ", serverName);

// Set up runtime before moving on
Runtime.signingKey = new SelfSigningKey(serverName);

// Start registering routes and stuff
const keyStore = new KeyStore();
const roomStore = new RoomStore(keyStore);
new ClientServerApi(serverName, roomStore).registerRoutes(app);
keyStore.registerRoutes(app);

app.listen(port, () => console.log(`Listening on ${port}`));
