import {PDU} from "./models/event";
import EventEmitter from "events";
import {getDomainFromId} from "./util/id";
import {FederationClient} from "./FederationClient";
import {ParticipantRoom} from "./models/room/ParticipantRoom";
import {KeyStore} from "./KeyStore";
import {HubRoom} from "./models/room/HubRoom";
import {Runtime} from "./Runtime";
import {RoomStore} from "./RoomStore";

export class InviteStore {
    private pending: PDU[] = [];

    private emitter = new EventEmitter();

    public constructor(private keyStore: KeyStore, private roomStore: RoomStore) {}

    public addInvite(invite: PDU) {
        this.pending.push(invite);
        this.emitter.emit("invite", invite);
    }

    public async acceptInvite(roomId: string, userId: string): Promise<void> {
        const invite = this.pending.find(i => i.state_key === userId && i.room_id === roomId);
        if (!invite) {
            throw new Error("No pending invite");
        }

        const respondToDomain = getDomainFromId(invite.sender);
        const client = new FederationClient(respondToDomain);
        const [state, joinEvent] = await client.acceptInvite(invite);
        let room: ParticipantRoom | undefined = await HubRoom.createRoomFromState(state, this.keyStore);
        if (!room) {
            throw new Error("Unable to create room");
        }
        if (room.hubDomain !== Runtime.signingKey.serverName) {
            room = ParticipantRoom.createFromOtherRoom(room);
        }
        this.roomStore.addRoom(room);

        if (room instanceof HubRoom) {
            await room.receivePdu(joinEvent);
        } else {
            await room.receiveEvent(joinEvent);
        }

        this.pending = this.pending.filter(i => i !== invite);
    }

    public on(event: "invite", fn: (event: PDU) => void): void;
    public on(event: string, fn: (...args: any[]) => void): void {
        this.emitter.on(event, fn);
    }

    public off(event: "invite", fn: (event: PDU) => void): void;
    public off(event: string, fn: (...args: any[]) => void): void {
        this.emitter.off(event, fn);
    }
}
