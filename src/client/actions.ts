import {getDomainFromId} from "../server/util/id";
import {LocalState} from "./local_state";
import {randomUUID} from "crypto";
import {mlsGetState, mlsMakeGroup} from "./mls";
import {wsSendDsRequest} from "./ws";
import {PacketType} from "../server/client_server_api/packets";
import {CreateGroupBody, CreateGroupResponse, DSProtocolVersion} from "../server/client_server_api/MIMIDSProtocol";

let didSendFirstInvite = false;

export function doSendInvite(inviteRoomId: string, inviteUserId: string) {}

export async function doCreateRoom() {
    const serverName = getDomainFromId(LocalState.myUserId!);
    const localpart = randomUUID(); // TODO: Guarantee uniqueness
    const roomId = `!${localpart}:${serverName}`;

    mlsMakeGroup(roomId);
    const resp = await wsSendDsRequest<CreateGroupResponse>({
        type: PacketType.DSRequest,
        requestId: randomUUID(),
        authData: undefined,
        groupId: roomId,
        protocolVersion: DSProtocolVersion.v1,
        requestBody: <CreateGroupBody>{
            type: "create_group",
            groupId: roomId,
            groupInfo: mlsGetState(roomId),
        },
    });
    if (resp.error) {
        console.error(resp.error);
        process.exit(1);
    }

    // after creating...
    if (!didSendFirstInvite && process.env["ES_SEND_INVITE"]) {
        didSendFirstInvite = true;
        doSendInvite(roomId, process.env["ES_SEND_INVITE"]!);
    }
}

export function doJoinRoom(roomId: string) {}

export function doSendAppMessage(roomId: string, text: string) {}
