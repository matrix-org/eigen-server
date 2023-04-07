import express from "express";
import {KeyStore} from "./KeyStore";
import {RoomStore} from "./RoomStore";
import {ClientServerApi} from "./client_server_api/ClientServerApi";
import {Runtime} from "./Runtime";
import {SelfSigningKey} from "./SelfSigningKey";
import {FederationServer} from "./FederationServer";
import bodyParser from "body-parser";
import {InviteStore} from "./InviteStore";

const port: number = Number(process.env["LM_PORT"] ?? 3000);
const serverName = `localhost:${port}`;
const app = express();
app.use(bodyParser.json());

console.log("Server name: ", serverName);

// Set up runtime before moving on
Runtime.signingKey = new SelfSigningKey(serverName);

// Start registering routes and stuff
const keyStore = new KeyStore();
const roomStore = new RoomStore(keyStore);
const inviteStore = new InviteStore(keyStore, roomStore);
const csApi = new ClientServerApi(serverName, roomStore, inviteStore);
csApi.registerRoutes(app);
keyStore.registerRoutes(app);
new FederationServer(roomStore, keyStore, inviteStore).registerRoutes(app);

app.listen(port, () => console.log(`Listening on ${port}`));
