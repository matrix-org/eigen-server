import {HubRoom} from "./models/room/HubRoom";
import {KeyStore} from "./KeyStore";
import EventEmitter from "events";
import {ParticipantRoom} from "./models/room/ParticipantRoom";

export class RoomStore {
    private rooms: ParticipantRoom[] = []; // TODO: Persist

    private emitter = new EventEmitter();

    public constructor(private keyStore: KeyStore) {}

    public get allRooms(): ParticipantRoom[] {
        return this.rooms;
    }

    public async createRoom(creator: string): Promise<HubRoom> {
        const room = await HubRoom.create(creator, this.keyStore);
        this.addRoom(room);
        return room;
    }

    public getRoom(roomId: string): ParticipantRoom | undefined {
        return this.rooms.find(r => r.roomId === roomId);
    }

    public addRoom(room: ParticipantRoom) {
        this.rooms.push(room);
        this.emitter.emit("room", room);
    }

    public on(event: "room", fn: (room: ParticipantRoom) => void): void;
    public on(event: string, fn: (...args: any[]) => void): void {
        this.emitter.on(event, fn);
    }

    public off(event: "room", fn: (room: ParticipantRoom) => void): void;
    public off(event: string, fn: (...args: any[]) => void): void {
        this.emitter.off(event, fn);
    }
}
