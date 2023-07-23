import inquirer from "inquirer";
import {LoginPacket, Packet, PacketType} from "../server/client_server_api/packets";
import * as sourceMapSupport from "source-map-support";
import {doCreateRoom, doJoinRoom, doSendAppMessage, doSendInvite} from "./actions";
import {setupWs, ws} from "./ws";
import {mlsLogin} from "./mls";
import {LocalState} from "./local_state";

sourceMapSupport.install();

const ui = new inquirer.ui.BottomBar();

ui.log.write("--------------------------------------------------");
ui.log.write("==        EIGEN-SERVER DEVELOPMENT CLIENT       ==");
ui.log.write("--------------------------------------------------");
ui.log.write("Not for production use. Limited to a single room.");
ui.log.write("Press Ctrl+C to exit or type '\\q'");
ui.log.write("--------------------------------------------------");
ui.log.write("");

let buffer: string = "";
let currentRoomId: string | null = null;

function render() {
    ui.updateBottomBar("> " + buffer);
}
render();

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (key: string) => {
    if (key === "\u0003") {
        // Ctrl+C
        process.exit(0);
    } else if (key === "\u0008") {
        // Backspace
        if (buffer.length > 0) {
            buffer = buffer.substring(0, buffer.length - 1);
            render();
        }
        return;
    } else if (key === "\u000d") {
        // Enter
        let command = false;
        if (buffer.trim() === "\\q") {
            process.exit(0);
        } else if (buffer.trim() === "/createRoom") {
            command = true;
            doCreateRoom();
        } else if (buffer.trim().startsWith("/invite ")) {
            command = true;
            if (!currentRoomId) {
                ui.log.write("* | You are not chatting in a room and cannot invite.");
            } else {
                doSendInvite(currentRoomId, buffer.trim().substring("/invite ".length));
            }
        } else if (buffer.trim().startsWith("/join ")) {
            command = true;
            doJoinRoom(buffer.trim().substring("/join ".length));
        }
        if (command) {
            ui.log.write(buffer);
        } else {
            if (!currentRoomId) {
                ui.log.write("* | You are not chatting in a room.");
            } else {
                doSendAppMessage(currentRoomId, buffer);
            }
        }
        buffer = "";
        render();
        return;
    }
    buffer += key;
    render();
});

setupWs();
ws.on("open", () => {
    ui.log.write("* | Connected");
});

ws.on("message", data => {
    const packet = JSON.parse(data as unknown as string) as Packet;
    switch (packet.type) {
        case PacketType.Login:
            return onLogin(packet as LoginPacket);
        case PacketType.DSResponse:
            // ignore - handled out of band from here
            return;
        default:
            return ui.log.write("* | " + data);
    }
});

ws.on("close", () => {
    ui.log.write("* | Goodbye");
    process.exit(0);
});

function onLogin(packet: LoginPacket) {
    LocalState.myUserId = packet.userId;
    LocalState.myDeviceId = packet.deviceId;
    mlsLogin(packet.userId, packet.deviceId);
    ui.log.write(`* | You are ${LocalState.myUserId} / ${LocalState.myDeviceId}`);
    if (process.env["ES_CREATE_ROOM"] === "true") {
        doCreateRoom();
    }
}
