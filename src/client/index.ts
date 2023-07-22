import inquirer from "inquirer";
import WebSocket from "ws";
import {
    DumpRoomInfoPacket,
    EventPacket,
    InvitePacket,
    JoinPacket,
    LoginPacket,
    Packet,
    PacketType,
    RoomInvitedPacket,
    RoomJoinedPacket,
    SendPacket,
} from "../server/client_server_api/packets";
import * as sourceMapSupport from "source-map-support";
import * as dmlsWasm from "@matrix-org/matrix-dmls-wasm"; // TODO: Use this import

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
let myUserId: string | null = null;
let didFirstInvite = false;

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
            sendPacket({type: PacketType.CreateRoom});
        } else if (buffer.trim() === "/dump") {
            command = true;
            sendPacket(<DumpRoomInfoPacket>{type: PacketType.DumpRoomInfo, roomId: currentRoomId});
        } else if (buffer.trim().startsWith("/invite ")) {
            command = true;
            const inviteUserId = buffer.trim().substring("/invite ".length);
            if (!currentRoomId) {
                ui.log.write("* | You are not chatting in a room and cannot invite.");
            } else {
                sendPacket({
                    type: PacketType.Invite,
                    targetRoomId: currentRoomId,
                    targetUserId: inviteUserId,
                } as InvitePacket);
            }
        } else if (buffer.trim().startsWith("/join ")) {
            command = true;
            const joinRoomId = buffer.trim().substring("/join ".length);
            sendPacket({
                type: PacketType.Join,
                targetRoomId: joinRoomId,
            } as JoinPacket);
        }
        if (command) {
            ui.log.write(buffer);
        } else {
            if (!currentRoomId) {
                ui.log.write("* | You are not chatting in a room.");
            } else {
                sendPacket({
                    type: PacketType.Send,
                    roomId: currentRoomId,
                    eventType: "m.room.message",
                    stateKey: undefined,
                    content: {body: buffer, msgtype: "m.text"},
                } as SendPacket);
            }
        }
        buffer = "";
        render();
        return;
    }
    buffer += key;
    render();
});

const ws = new WebSocket(
    `ws://${process.env["ES_HOSTNAME"] || "localhost"}:${
        process.env["ES_PORT"] ?? 3000
    }/client?preferredLocalpart=${encodeURIComponent(process.env["ES_LOCALPART"] ?? "")}`,
);
ws.on("open", () => {
    ui.log.write("* | Connected");
});

ws.on("message", data => {
    const packet = JSON.parse(data as unknown as string) as Packet;
    switch (packet.type) {
        case PacketType.RoomJoined:
            return onJoin(packet as RoomJoinedPacket);
        case PacketType.RoomInvited:
            return onInvite(packet as RoomInvitedPacket);
        case PacketType.Login:
            return onLogin(packet as LoginPacket);
        case PacketType.Event:
            return onEvent(packet as EventPacket);
        default:
            return ui.log.write("* | " + data);
    }
});

ws.on("close", () => {
    ui.log.write("* | Goodbye");
    process.exit(0);
});

function sendPacket(packet: Packet) {
    ws.send(JSON.stringify(packet));
}

function onLogin(packet: LoginPacket) {
    myUserId = packet.userId;
    ui.log.write(`* | You are ${myUserId}`);
    if (process.env["ES_CREATE_ROOM"] === "true") {
        sendPacket({type: PacketType.CreateRoom});
    }
}

function onJoin(join: RoomJoinedPacket) {
    if (join.targetUserId === myUserId) {
        currentRoomId = join.roomId;
        ui.log.write(`* | You are now chatting in ${currentRoomId}`);

        if (!didFirstInvite && process.env["ES_SEND_INVITE"]) {
            sendPacket(<InvitePacket>{
                type: PacketType.Invite,
                targetRoomId: currentRoomId,
                targetUserId: process.env["ES_SEND_INVITE"],
            });
            didFirstInvite = true;
        }
    } else if (join.roomId === currentRoomId) {
        ui.log.write(`* | ${join.targetUserId} joined the room`);
    }
}

function onInvite(invite: RoomInvitedPacket) {
    if (invite.targetUserId === myUserId && invite.roomId !== currentRoomId) {
        ui.log.write(`* | You have been invited to ${invite.roomId} - accept with \`/join ${invite.roomId}\``);
    } else if (invite.roomId === currentRoomId) {
        ui.log.write(`* | ${invite.targetUserId} was invited to the room`);
    }
}

function onEvent(packet: EventPacket) {
    const event = packet.event;
    const displayName = event.sender === myUserId ? "You" : event.sender;
    if (packet.rawFormat) {
        ui.log.write(JSON.stringify(event));
    } else {
        ui.log.write(
            `${displayName} | ${event.event_id} ${event.type} (state_key: ${JSON.stringify(
                event.state_key,
            )}) ${JSON.stringify(event.content)}`,
        );
    }
}
