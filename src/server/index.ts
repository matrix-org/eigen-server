import express from "express";
import {KeyStore} from "./KeyStore";
import {RoomStore} from "./RoomStore";
import {ClientServerApi} from "./client_server_api/ClientServerApi";
import {Runtime} from "./Runtime";
import {SelfSigningKey} from "./SelfSigningKey";
import {FederationServer} from "./FederationServer";
import bodyParser from "body-parser";
import {InviteStore} from "./InviteStore";
import * as sourceMapSupport from "source-map-support";
import {FederationConnectionCache} from "./FederationConnectionCache";

sourceMapSupport.install();

const port: number = Number(process.env["ES_PORT"] ?? 3000);
const serverName = `${process.env["ES_HOSTNAME"] || "localhost"}:${port}`;
const app = express();
app.use(bodyParser.json());

app.get("/test", async (req, res) => {
    const name = req.query["name"] as string;
    const connectionDetails = await FederationConnectionCache.getFederationUrl(name);
    res.status(200);
    res.write(JSON.stringify(connectionDetails, null, 2) + "\n\n-----\n\n");
    try {
        const result = await (
            await fetch(`${connectionDetails.httpsUrl}/_matrix/federation/v1/version`, {
                headers: {
                    Host: connectionDetails.certificateHostname,
                },
            })
        ).json();
        res.write(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
        res.write("<!! HTTP REQUEST FAILED !!>");
    }
    res.send();
});

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
