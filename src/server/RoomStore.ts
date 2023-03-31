import {Room} from "./models/Room";
import {KeyStore} from "./KeyStore";

export class RoomStore {
    private rooms: Room[] = []; // TODO: Persist

    public constructor(private keyStore: KeyStore) {}

    public async createRoom(creator: string): Promise<Room> {
        const room = await Room.create(creator, this.keyStore);
        this.rooms.push(room);
        return room;
    }

    public getRoom(roomId: string): Room | undefined {
        return this.rooms.find(r => r.roomId === roomId);
    }

    public addRoom(room: Room) {
        this.rooms.push(room);
    }
}
